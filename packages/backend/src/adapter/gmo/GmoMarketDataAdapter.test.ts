import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GmoMarketDataAdapter } from './GmoMarketDataAdapter.js';
import type { GmoWebSocketClient } from './GmoWebSocketClient.js';
import { Tick } from '../../domain/market/tick/Tick.js';

// Logger 出力を抑制
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

/** GmoWebSocketClient のモック */
const mockWsClient = (): GmoWebSocketClient & {
  _triggerMessage: (data: string) => void;
  _triggerOpen: () => void;
} => {
  let onMessageCb: ((data: string) => void) | null = null;
  let onOpenCb: (() => void) | null = null;

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    send: vi.fn(),
    onMessage: vi.fn((cb: (data: string) => void) => {
      onMessageCb = cb;
    }),
    onOpen: vi.fn((cb: () => void) => {
      onOpenCb = cb;
    }),
    onClose: vi.fn(),
    get isConnected() {
      return true;
    },
    _triggerMessage(data: string) {
      onMessageCb?.(data);
    },
    _triggerOpen() {
      onOpenCb?.();
    },
  } as unknown as GmoWebSocketClient & {
    _triggerMessage: (data: string) => void;
    _triggerOpen: () => void;
  };
};

const makeTickerJson = (overrides?: Partial<Record<string, string>>): string =>
  JSON.stringify({
    symbol: 'USD_JPY',
    ask: '150.500',
    bid: '150.495',
    timestamp: '2026-03-29T10:00:00.000Z',
    status: 'OPEN',
    ...overrides,
  });

describe('GmoMarketDataAdapter', () => {
  let ws: ReturnType<typeof mockWsClient>;
  let adapter: GmoMarketDataAdapter;

  beforeEach(() => {
    ws = mockWsClient();
    adapter = new GmoMarketDataAdapter(ws, 'USD_JPY');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connect()', () => {
    it('WebSocketClient の connect を呼ぶ', async () => {
      await adapter.connect();

      expect(ws.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribe()', () => {
    it('ticker データを Tick に変換してリスナーに通知する', async () => {
      // Given: リスナーを登録
      const received: Tick[] = [];
      adapter.subscribe((tick) => received.push(tick));

      // When: ticker メッセージが到着
      ws._triggerMessage(makeTickerJson());

      // Then: Tick に変換されてリスナーに渡っている
      expect(received).toHaveLength(1);
      expect(received[0].ask().toString()).toBe('150.5');
      expect(received[0].bid().toString()).toBe('150.495');
    });

    it('unsubscribe 関数で購読を解除できる', () => {
      // Given: リスナーを登録して解除
      const received: Tick[] = [];
      const unsubscribe = adapter.subscribe((tick) => received.push(tick));
      unsubscribe();

      // When: メッセージが到着
      ws._triggerMessage(makeTickerJson());

      // Then: リスナーは呼ばれない
      expect(received).toHaveLength(0);
    });
  });

  describe('市場ステータスフィルタリング', () => {
    it('status=CLOSE の tick は無視する', () => {
      // Given: リスナーを登録
      const received: Tick[] = [];
      adapter.subscribe((tick) => received.push(tick));

      // When: CLOSE ステータスの ticker が到着
      ws._triggerMessage(makeTickerJson({ status: 'CLOSE' }));

      // Then: リスナーは呼ばれない
      expect(received).toHaveLength(0);
    });

    it('status=OPEN の tick は正常に処理する', () => {
      const received: Tick[] = [];
      adapter.subscribe((tick) => received.push(tick));

      ws._triggerMessage(makeTickerJson({ status: 'OPEN' }));

      expect(received).toHaveLength(1);
    });
  });

  describe('接続時の購読', () => {
    it('接続確立時に ticker チャネルを購読する', () => {
      // When: open イベントが発火
      ws._triggerOpen();

      // Then: subscribe メッセージが送信されている
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          command: 'subscribe',
          channel: 'ticker',
          symbol: 'USD_JPY',
        }),
      );
    });
  });

  describe('不正なメッセージ', () => {
    it('JSON パース不可のメッセージを無視する', () => {
      const received: Tick[] = [];
      adapter.subscribe((tick) => received.push(tick));

      // When: 不正な文字列が届く
      ws._triggerMessage('not-json');

      // Then: エラーにならず無視される
      expect(received).toHaveLength(0);
    });

    it('ask/bid がないメッセージを無視する', () => {
      const received: Tick[] = [];
      adapter.subscribe((tick) => received.push(tick));

      // When: 購読確認メッセージが届く
      ws._triggerMessage('{"result":"subscribed"}');

      // Then: 無視される
      expect(received).toHaveLength(0);
    });
  });

  describe('disconnect()', () => {
    it('リスナーをクリアして WebSocket を切断する', async () => {
      // Given: リスナー登録済み
      const received: Tick[] = [];
      adapter.subscribe((tick) => received.push(tick));

      // When: disconnect
      await adapter.disconnect();

      // Then: WebSocketClient が切断されている
      expect(ws.disconnect).toHaveBeenCalled();
    });
  });
});
