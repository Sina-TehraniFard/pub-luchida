import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GmoWebSocketClient } from './GmoWebSocketClient.js';
import { MarketDataError } from '../../domain/error/MarketDataError.js';

// Logger 出力を抑制
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

/**
 * ws ライブラリをモックして GmoWebSocketClient の振る舞いを検証する。
 * 実際の WebSocket 接続は行わない。
 */

// イベントハンドラを保持する簡易モック
type EventHandler = (...args: unknown[]) => void;

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  readyState = MockWebSocket.CONNECTING;
  private handlers = new Map<string, EventHandler[]>();

  on(event: string, handler: EventHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: unknown[]): void {
    const list = this.handlers.get(event) ?? [];
    for (const handler of list) handler(...args);
  }

  send = vi.fn();
  ping = vi.fn();
  close = vi.fn();
  terminate = vi.fn();

  // テスト用: open イベントを発火して接続完了にする
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  simulateMessage(data: string): void {
    this.emit('message', Buffer.from(data));
  }

  // テスト用: サーバからの ping 受信をシミュレートする
  simulateServerPing(): void {
    this.emit('ping');
  }

  simulateClose(code = 1006, reason = ''): void {
    this.readyState = 3; // CLOSED
    this.emit('close', code, Buffer.from(reason));
  }
}

let mockWsInstance: MockWebSocket;
// テスト用: new WebSocket() 自体の失敗（close イベントが発生しない失敗経路）をシミュレートする
let wsConstructorThrows = false;

vi.mock('ws', () => {
  return {
    default: class {
      static readonly OPEN = 1;
      static readonly CONNECTING = 0;
      constructor() {
        if (wsConstructorThrows) throw new Error('constructor failure');
        return mockWsInstance;
      }
    },
  };
});

describe('GmoWebSocketClient', () => {
  let client: GmoWebSocketClient;

  beforeEach(() => {
    mockWsInstance = new MockWebSocket();
    client = new GmoWebSocketClient('wss://example.com/ws');
    vi.useFakeTimers();
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
  });

  describe('connect()', () => {
    it('WebSocket 接続が確立される', async () => {
      // When: connect を開始し、open イベントを発火
      const connectPromise = client.connect();
      mockWsInstance.simulateOpen();
      await connectPromise;

      // Then: 接続状態になっている
      expect(client.isConnected).toBe(true);
    });
  });

  describe('disconnect()', () => {
    it('接続を意図的に切断する', async () => {
      // Given: 接続済み
      const connectPromise = client.connect();
      mockWsInstance.simulateOpen();
      await connectPromise;

      // When: disconnect を呼ぶ
      client.disconnect();

      // Then: close が呼ばれている
      expect(mockWsInstance.close).toHaveBeenCalled();
    });
  });

  describe('send()', () => {
    it('接続済みならメッセージを送信する', async () => {
      // Given: 接続済み
      const connectPromise = client.connect();
      mockWsInstance.simulateOpen();
      await connectPromise;

      // When: メッセージを送信
      client.send('{"command":"subscribe"}');

      // Then: ws.send が呼ばれている
      expect(mockWsInstance.send).toHaveBeenCalledWith('{"command":"subscribe"}');
    });

    it('未接続なら MarketDataError を throw する', () => {
      expect(() => client.send('test')).toThrow(MarketDataError);
    });
  });

  describe('onMessage()', () => {
    it('受信メッセージがコールバックに渡される', async () => {
      // Given: コールバックを設定して接続
      const received: string[] = [];
      client.onMessage((data) => received.push(data));
      const connectPromise = client.connect();
      mockWsInstance.simulateOpen();
      await connectPromise;

      // When: メッセージを受信
      mockWsInstance.simulateMessage('{"ask":"150.123"}');

      // Then: コールバックにデータが渡されている
      expect(received).toEqual(['{"ask":"150.123"}']);
    });
  });

  describe('サーバ ping 監視', () => {
    // GMO はサーバから 1 分に 1 回 ping を送る。SERVER_PING_TIMEOUT_MS を超えて
    // サーバ ping が来なければ接続が死んだとみなして terminate する。
    // 本体の定数を直接参照し、閾値変更にテストが追従するようにする。
    // 前提: SERVER_PING_TIMEOUT_MS は SERVER_PING_CHECK_INTERVAL_MS の倍数。
    // 倍数でなくなると「TIMEOUT_MS ちょうどで terminate」は最大1周期遅れる。
    const TIMEOUT_MS = GmoWebSocketClient['SERVER_PING_TIMEOUT_MS'];

    it('サーバ ping が一定時間来なければ接続を切断する', async () => {
      // Given: 接続済み
      const connectPromise = client.connect();
      mockWsInstance.simulateOpen();
      await connectPromise;

      // When: タイムアウト閾値ちょうど経過（サーバ ping を一度も受けない）
      vi.advanceTimersByTime(TIMEOUT_MS);

      // Then: 接続が強制切断される
      expect(mockWsInstance.terminate).toHaveBeenCalled();
    });

    it('サーバ ping を受信し続ける限り切断しない', async () => {
      // Given: 接続済み
      const connectPromise = client.connect();
      mockWsInstance.simulateOpen();
      await connectPromise;

      // When: タイムアウト未満ごとにサーバ ping を受信し続ける
      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(60_000); // サーバの実周期（1分）
        mockWsInstance.simulateServerPing();
      }

      // Then: terminate されない
      expect(mockWsInstance.terminate).not.toHaveBeenCalled();
    });

    it('サーバ ping 受信で猶予が更新される', async () => {
      // Given: 接続済み
      const connectPromise = client.connect();
      mockWsInstance.simulateOpen();
      await connectPromise;

      // When: タイムアウト手前で ping を1発受け、受信時刻を更新する
      vi.advanceTimersByTime(TIMEOUT_MS - 10_000);
      mockWsInstance.simulateServerPing();

      // 監視開始起点なら既に切断されている時刻まで進めても、ping で猶予が伸びている
      vi.advanceTimersByTime(TIMEOUT_MS - 10_000);
      // Then: ping ハンドラが受信時刻を更新している証拠（更新しなければここで切断済み）
      expect(mockWsInstance.terminate).not.toHaveBeenCalled();

      // さらに更新後の猶予を超えれば切断される
      vi.advanceTimersByTime(20_000);
      expect(mockWsInstance.terminate).toHaveBeenCalled();
    });

    it('サーバ ping 未受信でもタイムアウト前は切断しない', async () => {
      // Given: 接続済み（lastServerPingAt は open 時に初期化される）
      const connectPromise = client.connect();
      mockWsInstance.simulateOpen();
      await connectPromise;

      // When: タイムアウト1秒手前まで経過（サーバ ping は一度も来ない）
      vi.advanceTimersByTime(TIMEOUT_MS - 1000);

      // Then: 起動直後の誤切断を防ぐため、まだ terminate しない
      expect(mockWsInstance.terminate).not.toHaveBeenCalled();
    });
  });

  describe('指数バックオフ再接続', () => {
    // open 成功前に切断が続くケース。再接続タイマーが connect() を再呼び出しし、
    // その都度 new WebSocket() が走るため、テスト側で次のモックインスタンスを差し替える。
    // 再接続ログ（INFO=console.log）に出る backoffMs の系列で待機時間の遷移を検証する。

    // これまでに記録された再接続ログから backoffMs の系列を取り出す。
    function reconnectBackoffs(): number[] {
      const logSpy = console.log as unknown as { mock: { calls: unknown[][] } };
      return logSpy.mock.calls
        .map((args) => {
          try {
            return JSON.parse(args[0] as string) as { data?: { backoffMs?: number } };
          } catch {
            return null;
          }
        })
        .filter(
          (e): e is { data: { backoffMs: number } } =>
            typeof e?.data?.backoffMs === 'number',
        )
        .map((e) => e.data.backoffMs);
    }

    beforeEach(() => {
      // backoffMs 系列をテストごとに分離するため、ログ呼び出し履歴をクリア
      (console.log as unknown as { mockClear: () => void }).mockClear();
      wsConstructorThrows = false;
    });

    it('open しないまま切断が続くと待機時間が指数的に伸びる', () => {
      // Given: 接続を試みたが open せずに切断（connect() は open まで resolve しないので await しない）
      void client.connect();
      mockWsInstance.simulateClose(); // 試行1 → backoff 1秒

      // When: バックオフ待機ごとに connect() が再発火し、open せず再び切断する
      mockWsInstance = new MockWebSocket();
      vi.advanceTimersByTime(1000); // 1秒後に再接続発火
      mockWsInstance.simulateClose(); // 試行2 → backoff 2秒

      mockWsInstance = new MockWebSocket();
      vi.advanceTimersByTime(2000); // 2秒後に再接続発火
      mockWsInstance.simulateClose(); // 試行3 → backoff 4秒

      // Then: backoff が 1000 → 2000 → 4000 と倍々に伸びている
      // （connect() 冒頭の reconnectAttempts リセットが残ると毎回 1000 のままになり、ここで落ちる）
      expect(reconnectBackoffs()).toEqual([1000, 2000, 4000]);
    });

    it('切断が何回続いても再接続を諦めない（旧上限10回の撤廃 #342）', () => {
      // Given: 接続を試みたが open せずに切断（open まで resolve しないので await しない）
      void client.connect();
      mockWsInstance.simulateClose(); // 試行1 スケジュール

      // When: 旧上限（10回）を大きく超えて「待機 → close」を繰り返す
      for (let i = 0; i < 15; i++) {
        mockWsInstance = new MockWebSocket();
        vi.advanceTimersByTime(GmoWebSocketClient['MAX_BACKOFF_MS']); // どのバックオフでも発火する
        mockWsInstance.simulateClose(); // 次の試行をスケジュール
      }

      // Then: 16回すべてで再接続がスケジュールされている（打ち切りが残っていれば系列が10で止まる）
      expect(reconnectBackoffs()).toHaveLength(16);
    });

    it('再接続待機中に close が重複発火しても試行カウンタが二重に進まない', () => {
      // Given: open せずに切断 → 再接続がスケジュールされている
      void client.connect();
      mockWsInstance.simulateClose(); // 試行1 → backoff 1秒

      // When: 同一失敗で close がもう一度発火する（ws は error→close と連続発火しうる）
      mockWsInstance.simulateClose();

      // Then: 追加スケジュールされず、系列は1件のまま（ガードがなければ [1000, 2000] になる）
      expect(reconnectBackoffs()).toEqual([1000]);
    });

    it('close イベントが発生しない失敗（コンストラクタ throw）でもチェーンが途切れない', async () => {
      // Given: open せずに切断され、再接続がスケジュールされている
      void client.connect();
      mockWsInstance.simulateClose(); // 試行1 → backoff 1秒

      // When: 再接続発火時に new WebSocket() 自体が throw する
      //（close イベントが出ないため、close ハンドラ経由では次がスケジュールされない）
      wsConstructorThrows = true;
      await vi.advanceTimersByTimeAsync(1000);
      wsConstructorThrows = false;

      // Then: connect() の失敗経路から次の再接続がスケジュールされ、チェーンが継続している
      expect(reconnectBackoffs()).toEqual([1000, 2000]);
    });

    it('バックオフの待機時間は5分で頭打ちになる', () => {
      // Given: 接続を試みたが open せずに切断
      void client.connect();
      mockWsInstance.simulateClose(); // 試行1 → backoff 1秒

      // When: 頭打ちを超える回数まで「待機 → close」を繰り返す
      for (let i = 0; i < 11; i++) {
        mockWsInstance = new MockWebSocket();
        vi.advanceTimersByTime(GmoWebSocketClient['MAX_BACKOFF_MS']);
        mockWsInstance.simulateClose();
      }

      // Then: 1→2→4→...→256秒と伸び、512秒にはならず300秒（5分）で頭打ちのまま
      expect(reconnectBackoffs()).toEqual([
        1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000,
        300_000, 300_000, 300_000,
      ]);
    });

    it('再接続中に open 成功すると試行カウンタがリセットされる', () => {
      // Given: 2回切断して backoff が伸びた状態（1秒 → 2秒）
      void client.connect();
      mockWsInstance.simulateClose(); // 試行1 → backoff 1秒
      mockWsInstance = new MockWebSocket();
      vi.advanceTimersByTime(1000);
      mockWsInstance.simulateClose(); // 試行2 → backoff 2秒

      // When: 再接続が発火し、今度は open に成功する
      mockWsInstance = new MockWebSocket();
      vi.advanceTimersByTime(2000); // connect() 再呼び出し
      mockWsInstance.simulateOpen(); // open 成功 → reconnectAttempts が 0 に戻る
      expect(client.isConnected).toBe(true);

      // 再び切断すると、open リセットが効いていれば backoff は起点 1 秒に戻る
      mockWsInstance.simulateClose();

      // Then: backoff 系列は 1000 → 2000（open前）→ 1000（リセット後の起点）
      expect(reconnectBackoffs()).toEqual([1000, 2000, 1000]);
    });
  });
});
