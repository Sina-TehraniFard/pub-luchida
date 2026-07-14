import type { MarketDataPort } from '../../port/MarketDataPort.js';
import { Tick } from '../../domain/market/tick/Tick.js';
import { Price } from '../../domain/market/Price.js';
import { TickTimestamp } from '../../domain/market/tick/TickTimestamp.js';
import { MarketDataError } from '../../domain/error/MarketDataError.js';
import { GmoWebSocketClient } from './GmoWebSocketClient.js';
import { Logger } from '../../infrastructure/logging/Logger.js';

/**
 * MarketDataPort の実装。
 * GMO FX の Public WebSocket から ticker データを受信し、Tick 値オブジェクトに変換する。
 */
export class GmoMarketDataAdapter implements MarketDataPort {
  private readonly logger = new Logger('GmoMarketDataAdapter', 'MARKET');
  private readonly wsClient: GmoWebSocketClient;
  private readonly listeners = new Set<(tick: Tick) => void>();
  private symbol: string;
  private firstTickLogged = false;

  // tick レートサマリー用
  private summaryTickCount = 0;
  private summarySpreadSum = 0;
  private lastBid = '';
  private lastAsk = '';
  private lastTickTime: number | null = null;
  private summaryInterval: ReturnType<typeof setInterval> | null = null;

  private onErrorCallback: ((error: MarketDataError) => void) | null = null;

  constructor(wsClient: GmoWebSocketClient, symbol: string = 'USD_JPY') {
    this.wsClient = wsClient;
    this.symbol = symbol;

    this.wsClient.onMessage((raw) => this.handleMessage(raw));
    this.wsClient.onOpen(() => this.subscribeTicker());
  }

  /** 接続エラー（購読失敗等）を通知するコールバックを設定 */
  onError(callback: (error: MarketDataError) => void): void {
    this.onErrorCallback = callback;
  }

  async connect(): Promise<void> {
    try {
      await this.wsClient.connect();
      this.startSummaryInterval();
    } catch (err) {
      throw MarketDataError.connectionFailed(err);
    }
  }

  async disconnect(): Promise<void> {
    this.stopSummaryInterval();
    this.listeners.clear();
    this.wsClient.disconnect();
  }

  subscribe(onTick: (tick: Tick) => void): () => void {
    this.listeners.add(onTick);
    return () => {
      this.listeners.delete(onTick);
    };
  }

  private subscribeTicker(): void {
    const message = JSON.stringify({
      command: 'subscribe',
      channel: 'ticker',
      symbol: this.symbol,
    });

    try {
      this.wsClient.send(message);
      this.logger.info('ticker チャネルを購読', { symbol: this.symbol });
    } catch (err) {
      this.logger.error('ticker 購読に失敗', { error: String(err) });
      this.onErrorCallback?.(MarketDataError.subscriptionFailed('ticker', err));
    }
  }

  private handleMessage(raw: string): void {
    let json: GmoTickerMessage;
    try {
      json = JSON.parse(raw) as GmoTickerMessage;
    } catch {
      this.logger.warn('JSON パースに失敗', { raw: raw.slice(0, 200) });
      return;
    }

    // ticker チャネル以外のメッセージ（購読確認等）は無視
    if (!json.ask || !json.bid) return;

    // 市場クローズ時は tick を無視（ログ不要: 正常運用でほぼ発火せず、tick 毎に出すと量が破綻する）
    if (json.status === 'CLOSE') {
      return;
    }

    if (!this.firstTickLogged) {
      this.firstTickLogged = true;
      this.logger.info(`tick 受信開始 bid=${json.bid} ask=${json.ask}`, { ask: json.ask, bid: json.bid, status: json.status });
    }

    // tick ギャップ検知（5秒以上 tick が来なかった場合）
    const now = Date.now();
    if (this.lastTickTime !== null) {
      const gapSeconds = (now - this.lastTickTime) / 1000;
      if (gapSeconds >= 5) {
        this.logger.warn(`tick 途絶 ${gapSeconds.toFixed(1)}秒間受信なし`, { gapSeconds: parseFloat(gapSeconds.toFixed(1)) });
      }
    }
    this.lastTickTime = now;

    // サマリー用の統計を更新
    this.summaryTickCount++;
    this.lastBid = json.bid;
    this.lastAsk = json.ask;
    this.summarySpreadSum += parseFloat(json.ask) - parseFloat(json.bid);

    try {
      const tick = this.toTick(json);
      for (const listener of this.listeners) {
        listener(tick);
      }
    } catch (err) {
      this.logger.error('tick 変換に失敗', {
        error: String(err),
        ask: json.ask,
        bid: json.bid,
      });
    }
  }

  private toTick(msg: GmoTickerMessage): Tick {
    const ask = Price.of(msg.ask);
    const bid = Price.of(msg.bid);
    const timestamp = TickTimestamp.of(new Date(msg.timestamp));
    return Tick.of(ask, bid, timestamp);
  }

  private startSummaryInterval(): void {
    this.summaryInterval = setInterval(() => {
      if (this.summaryTickCount === 0) {
        this.logger.warn('60秒間 tick 受信なし');
        return;
      }
      const avgSpread = (this.summarySpreadSum / this.summaryTickCount).toFixed(4);
      this.logger.info(`60秒集計: ${this.summaryTickCount}tick スプレッド${avgSpread} bid=${this.lastBid}`, {
        tickCount: this.summaryTickCount,
        avgSpread,
        lastBid: this.lastBid,
        lastAsk: this.lastAsk,
      });
      this.summaryTickCount = 0;
      this.summarySpreadSum = 0;
    }, 60_000);
  }

  private stopSummaryInterval(): void {
    if (this.summaryInterval) {
      clearInterval(this.summaryInterval);
      this.summaryInterval = null;
    }
  }
}

/** GMO ticker WebSocket のメッセージ型 */
interface GmoTickerMessage {
  symbol: string;
  ask: string;
  bid: string;
  timestamp: string;
  status: 'OPEN' | 'CLOSE';
}
