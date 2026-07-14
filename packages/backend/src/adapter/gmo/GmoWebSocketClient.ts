import WebSocket from 'ws';
import { Logger } from '../../infrastructure/logging/Logger.js';
import { MarketDataError } from '../../domain/error/MarketDataError.js';

/**
 * GMO FX WebSocket の接続管理。
 * 接続確立、サーバ ping 監視による死活検知、指数バックオフ再接続を担う。
 * keepalive は GMO サーバ主導（サーバ ping → ws 自動 pong）で完結するため、自前 ping は送らない。
 */
export class GmoWebSocketClient {
  private readonly logger = new Logger('GmoWebSocketClient', 'BROKER');
  private ws: WebSocket | null = null;
  private lastServerPingAt: number | null = null;
  private serverPingWatchTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private onMessageCallback: ((data: string) => void) | null = null;
  private onOpenCallback: (() => void) | null = null;
  private onCloseCallback: (() => void) | null = null;
  private connectedAt: number | null = null;

  // 再接続は回数無制限で永久に再試行する。無人常駐のため打ち切っても復旧させる主体がなく、
  // 打ち切りは「tick が止まったまま稼働し続ける」状態を恒久化するだけ（#342）。
  // 接続先への試行頻度はこの間隔上限（5分）が抑える。
  private static readonly MAX_BACKOFF_MS = 300_000;
  // GMO はサーバから 1 分に 1 回 ping を送る。3 回連続無応答（≒180秒）でサーバ側が切断するため、
  // それと整合する 180秒 を無受信タイムアウトとする。
  private static readonly SERVER_PING_TIMEOUT_MS = 180_000;
  private static readonly SERVER_PING_CHECK_INTERVAL_MS = 30_000;

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.intentionalClose = false;

      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        reject(MarketDataError.connectionFailed(err));
        return;
      }

      this.ws.on('open', () => {
        const elapsed = this.connectedAt !== null
          ? `${((Date.now() - this.connectedAt) / 1000).toFixed(1)}s`
          : null;
        const connectLabel = elapsed === null
          ? 'WebSocket 接続（初回）'
          : `WebSocket 再接続（${this.reconnectAttempts}回目 経過${elapsed}）`;
        this.logger.info(connectLabel, {
          url: this.url,
          reconnectCount: this.reconnectAttempts,
          elapsed: elapsed ?? 'initial',
        });
        this.connectedAt = Date.now();
        this.reconnectAttempts = 0;
        this.startServerPingWatch();
        this.onOpenCallback?.();
        resolve();
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        this.onMessageCallback?.(raw.toString());
      });

      this.ws.on('ping', () => {
        this.lastServerPingAt = Date.now();
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason.toString() || 'unknown';
        const uptime = this.connectedAt !== null
          ? `${((Date.now() - this.connectedAt) / 1000).toFixed(1)}s`
          : 'unknown';
        this.logger.warn(`WebSocket 切断 code=${code}`, {
          code,
          reason: reasonStr,
          uptime,
          intentional: this.intentionalClose,
        });
        this.stopServerPingWatch();
        this.onCloseCallback?.();
        // error→close と連続発火する失敗で connect() の catch と二重にスケジュールしないよう、
        // 既に再接続待ちなら何もしない（試行カウンタが同一失敗で2回進むのを防ぐ）。
        if (!this.intentionalClose && !this.reconnectTimer) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        this.logger.error('WebSocket エラー', { error: String(err) });
        if (this.ws?.readyState === WebSocket.CONNECTING) {
          reject(MarketDataError.connectionFailed(err));
        }
      });
    });
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopServerPingWatch();
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw MarketDataError.disconnected();
    }
    this.ws.send(data);
  }

  onMessage(callback: (data: string) => void): void {
    this.onMessageCallback = callback;
  }

  onOpen(callback: () => void): void {
    this.onOpenCallback = callback;
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startServerPingWatch(): void {
    // 張る前に必ず畳む（冪等性）。既存タイマーへの参照を失ってのリークを防ぐ。
    this.stopServerPingWatch();
    // サーバ ping を一度も受けていない時点で誤切断しないよう、監視開始時を起点に初期化する。
    this.lastServerPingAt = Date.now();
    this.serverPingWatchTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.lastServerPingAt === null) return;

      const sinceLastPing = Date.now() - this.lastServerPingAt;
      if (sinceLastPing >= GmoWebSocketClient.SERVER_PING_TIMEOUT_MS) {
        this.logger.warn('サーバ ping 無受信タイムアウト → 切断', {
          sinceLastPingMs: sinceLastPing,
          timeoutMs: GmoWebSocketClient.SERVER_PING_TIMEOUT_MS,
        });
        this.ws.terminate();
      }
    }, GmoWebSocketClient.SERVER_PING_CHECK_INTERVAL_MS);
  }

  private stopServerPingWatch(): void {
    if (this.serverPingWatchTimer) {
      clearInterval(this.serverPingWatchTimer);
      this.serverPingWatchTimer = null;
    }
    // ソケットが無い＝生存時刻も無い。open 時の再初期化と対をなし、状態とライフサイクルを一致させる。
    this.lastServerPingAt = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    // 再接続チェーンは常に1本。既存の待機があれば置き換え、二重チェーンの永続化を防ぐ。
    this.clearReconnectTimer();

    const backoffMs = Math.min(
      1000 * 2 ** this.reconnectAttempts,
      GmoWebSocketClient.MAX_BACKOFF_MS,
    );
    this.reconnectAttempts++;

    this.logger.info(`${(backoffMs / 1000).toFixed(0)}秒後に再接続（試行${this.reconnectAttempts}回目）`, {
      attempt: this.reconnectAttempts,
      backoffMs,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        this.logger.error('再接続に失敗した', { error: String(err) });
        // 通常の失敗は close イベント経由で次がスケジュールされるが、
        // close が発生しない失敗（コンストラクタ throw 等）ではここが唯一の継続点。
        if (!this.intentionalClose && !this.reconnectTimer) {
          this.scheduleReconnect();
        }
      });
    }, backoffMs);
  }
}
