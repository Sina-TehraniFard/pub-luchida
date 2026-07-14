import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GmoBrokerAdapter } from './GmoBrokerAdapter.js';
import { EntryCommand } from '../../domain/command/EntryCommand.js';
import { Position } from '../../domain/position/Position.js';
import { CurrencyPair } from '../../domain/market/CurrencyPair.js';
import { Lot } from '../../domain/position/Lot.js';
import { ConvictionScore } from '../../domain/market/ConvictionScore.js';
import { EntryReason } from '../../domain/command/EntryReason.js';
import { BrokerError } from '../../domain/error/BrokerError.js';
import { GmoApiError } from './GmoApiError.js';
import { StrategyName } from '../../domain/rule/StrategyName.js';
import { EntrySnapshot } from '../../domain/market/snapshot/EntrySnapshot.js';
import { Money } from '../../domain/Money.js';
import type { GmoRestClient } from './GmoRestClient.js';

const DUMMY_SNAPSHOT = EntrySnapshot.of({ convictionScore: '0.5', entryHour: 12, entryDayOfWeek: 3 });

// Logger 出力を抑制
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const makeEntryCommand = (): EntryCommand =>
  EntryCommand.of({
    pair: CurrencyPair('USD_JPY'),
    buySell: 'BUY',
    lot: Lot.of(100),
    reason: EntryReason.of('SMA クロス'),
    convictionScore: ConvictionScore.of('0.8'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: DUMMY_SNAPSHOT,
    requiredMargin: Money.jpy('600'),
  });

const makeSpeedOrderResponse = (orderId: number = 12345) => ({
  status: 0,
  data: [{ orderId, rootOrderId: orderId, status: 'EXECUTED', symbol: 'USD_JPY', side: 'BUY', size: '100', settleType: 'OPEN', executionType: 'MARKET', timestamp: '2026-03-29T10:00:00Z' }],
  responsetime: '',
});

const makeExecutionsResponse = (overrides?: Partial<Record<string, unknown>>) => ({
  status: 0,
  data: {
    list: [
      {
        executionId: 99999,
        orderId: 12345,
        positionId: 67890,
        symbol: 'USD_JPY',
        side: 'BUY',
        settleType: 'OPEN',
        size: '100',
        price: '150.123',
        lossGain: '0',
        timestamp: '2026-03-29T10:00:01.000Z',
        ...overrides,
      },
    ],
  },
  responsetime: '',
});

const makeOpenPositionsResponse = (positionId: number = 99999) => ({
  status: 0,
  data: {
    list: [
      {
        positionId,
        symbol: 'USD_JPY',
        side: 'BUY',
        size: '100',
        price: '150.123',
        lossGain: '0',
        timestamp: '2026-03-29T10:00:01.000Z',
      },
    ],
  },
  responsetime: '',
});

// 指定した positionId 群を 1 ページ分の openPositions レスポンスとして組み立てる
const makeOpenPositionsPageResponse = (positionIds: readonly number[]) => ({
  status: 0,
  data: {
    list: positionIds.map((positionId) => ({
      positionId,
      symbol: 'USD_JPY',
      side: 'BUY',
      size: '100',
      price: '150.123',
      lossGain: '0',
      timestamp: '2026-03-29T10:00:01.000Z',
    })),
  },
  responsetime: '',
});

const makeClosingOrderResponse = (orderId: number = 54321) => ({
  status: 0,
  data: [{ orderId, rootOrderId: orderId, status: 'EXECUTED' }],
  responsetime: '',
});

describe('GmoBrokerAdapter', () => {
  let restClient: GmoRestClient;
  let broker: GmoBrokerAdapter;

  beforeEach(() => {
    restClient = {
      post: vi.fn(),
      get: vi.fn(),
      publicGet: vi.fn(),
    } as unknown as GmoRestClient;
    broker = new GmoBrokerAdapter(restClient);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('placeEntry()', () => {
    it('speedOrder を送信して EntryResult を返す', async () => {
      // Given: speedOrder 成功 → executions → openPositions
      vi.mocked(restClient.post).mockResolvedValue(makeSpeedOrderResponse());
      vi.mocked(restClient.get)
        .mockResolvedValueOnce(makeExecutionsResponse())
        .mockResolvedValueOnce(makeOpenPositionsResponse(99999));

      // When: エントリー注文を実行
      const command = makeEntryCommand();
      const resultPromise = broker.placeEntry(command);
      await vi.advanceTimersByTimeAsync(0);
      const result = await resultPromise;

      // Then: openPositions の positionId が使われる
      expect(result.entryPrice.toString()).toBe('150.123');
      expect(result.positionId.toString()).toBe('99999');
    });

    it('speedOrder に正しいパラメータを渡す', async () => {
      // Given: 正常レスポンス
      vi.mocked(restClient.post).mockResolvedValue(makeSpeedOrderResponse());
      vi.mocked(restClient.get)
        .mockResolvedValueOnce(makeExecutionsResponse())
        .mockResolvedValueOnce(makeOpenPositionsResponse());

      // When: BUY 100 USD_JPY の注文
      const command = makeEntryCommand();
      const resultPromise = broker.placeEntry(command);
      await vi.advanceTimersByTimeAsync(0);
      await resultPromise;

      // Then: speedOrder API に正しいボディが送られている
      expect(restClient.post).toHaveBeenCalledWith('/private/v1/speedOrder', {
        symbol: 'USD_JPY',
        side: 'BUY',
        size: '100',
        isHedgeable: true,
      });
    });

    it('約定が見つからない場合 BrokerError.executionTimeout を throw する', async () => {
      vi.useRealTimers();

      // Given: speedOrder は成功するが約定が常に空
      vi.mocked(restClient.post).mockResolvedValue(makeSpeedOrderResponse());
      vi.mocked(restClient.get).mockResolvedValue({
        status: 0,
        data: { list: [] },
        responsetime: '',
      });

      // ポーリング間隔を最小にするため、sleep を即座に解決するモックに差し替え
      const originalSetTimeout = globalThis.setTimeout;
      vi.stubGlobal('setTimeout', (fn: () => void) => originalSetTimeout(fn, 0));

      // When & Then: BrokerError が throw される
      const command = makeEntryCommand();
      await expect(broker.placeEntry(command)).rejects.toThrow(BrokerError);

      vi.unstubAllGlobals();
    });
  });

  describe('placeExit()', () => {
    it('closeOrder を送信して ExitResult を返す', async () => {
      // Given: エントリー済みのポジション
      vi.mocked(restClient.post).mockResolvedValueOnce(makeSpeedOrderResponse());
      vi.mocked(restClient.get)
        .mockResolvedValueOnce(makeExecutionsResponse())
        .mockResolvedValueOnce(makeOpenPositionsResponse(99999));

      const command = makeEntryCommand();
      const entryPromise = broker.placeEntry(command);
      await vi.advanceTimersByTimeAsync(0);
      const entryResult = await entryPromise;
      const position = Position.open(command, entryResult);

      // closeOrder 成功 → executions で決済約定確認
      vi.mocked(restClient.post).mockResolvedValueOnce(makeClosingOrderResponse());
      vi.mocked(restClient.get).mockResolvedValueOnce(
        makeExecutionsResponse({
          settleType: 'CLOSE',
          side: 'SELL',
          price: '151.000',
          lossGain: '87.7',
        }),
      );

      // When: 決済注文
      const exitPromise = broker.placeExit(position);
      await vi.advanceTimersByTimeAsync(0);
      const result = await exitPromise;

      // Then: ExitResult が正しく構築されている
      expect(result.exitPrice.toString()).toBe('151');
      expect(result.profitLoss.toString()).toBe('87.7');
    });

    it('BUY ポジションの決済は SELL + settlePosition で発注する', async () => {
      // Given: BUY でエントリー済み（openPositions positionId=99999）
      vi.mocked(restClient.post).mockResolvedValueOnce(makeSpeedOrderResponse());
      vi.mocked(restClient.get)
        .mockResolvedValueOnce(makeExecutionsResponse())
        .mockResolvedValueOnce(makeOpenPositionsResponse(99999));

      const command = makeEntryCommand();
      const entryPromise = broker.placeEntry(command);
      await vi.advanceTimersByTimeAsync(0);
      const entryResult = await entryPromise;
      const position = Position.open(command, entryResult);

      // closeOrder 設定
      vi.mocked(restClient.post).mockResolvedValueOnce(makeClosingOrderResponse());
      vi.mocked(restClient.get).mockResolvedValueOnce(makeExecutionsResponse({ settleType: 'CLOSE' }));

      // When: 決済
      const exitPromise = broker.placeExit(position);
      await vi.advanceTimersByTimeAsync(0);
      await exitPromise;

      // Then: closeOrder に openPositions の positionId が渡されている
      const closingCall = vi.mocked(restClient.post).mock.calls[1];
      expect(closingCall[0]).toBe('/private/v1/closeOrder');
      expect(closingCall[1]).toMatchObject({
        symbol: 'USD_JPY',
        side: 'SELL',
        executionType: 'MARKET',
        settlePosition: [{ positionId: 99999, size: '100' }],
      });
    });
  });

  describe('fetchOpenPositionIds()', () => {
    it('openPositions API の建玉を PositionId 一覧として返す', async () => {
      // Given
      vi.mocked(restClient.get).mockResolvedValueOnce(makeOpenPositionsResponse(99999));

      // When
      const ids = await broker.fetchOpenPositionIds(CurrencyPair('USD_JPY'));

      // Then: 1 ページ目で件数がページサイズ未満なので 1 回で完了
      expect(vi.mocked(restClient.get)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(restClient.get)).toHaveBeenCalledWith(
        '/private/v1/openPositions',
        { symbol: 'USD_JPY', count: '100' },
      );
      expect(ids.map((id) => id.toString())).toEqual(['99999']);
    });

    it('建玉が 1 ページ上限を超える場合、prevId カーソルで全ページを取得する', async () => {
      // Given: 1 ページ目が上限 100 件ちょうど（=続きがある）、2 ページ目が 2 件（=最終ページ）
      // positionId は降順で 200..101（1 ページ目）、100..99（2 ページ目）とする
      const firstPage = makeOpenPositionsPageResponse(
        Array.from({ length: 100 }, (_, i) => 200 - i), // 200, 199, ..., 101
      );
      const secondPage = makeOpenPositionsPageResponse([100, 99]);
      vi.mocked(restClient.get)
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage);

      // When
      const ids = await broker.fetchOpenPositionIds(CurrencyPair('USD_JPY'));

      // Then: 2 ページ取得し、全 102 件の建玉 ID を返す
      expect(vi.mocked(restClient.get)).toHaveBeenCalledTimes(2);
      // 1 ページ目は prevId なし
      expect(vi.mocked(restClient.get)).toHaveBeenNthCalledWith(
        1,
        '/private/v1/openPositions',
        { symbol: 'USD_JPY', count: '100' },
      );
      // 2 ページ目は 1 ページ目の最小 positionId（101）を prevId に指定
      expect(vi.mocked(restClient.get)).toHaveBeenNthCalledWith(
        2,
        '/private/v1/openPositions',
        { symbol: 'USD_JPY', count: '100', prevId: '101' },
      );
      expect(ids).toHaveLength(102);
      expect(ids.map((id) => id.toString())).toContain('101');
      expect(ids.map((id) => id.toString())).toContain('99');
    });

    it('ページングカーソルが前進しない場合 BrokerError.unexpected を throw する', async () => {
      // Given: 毎ページ満杯（=続きがある扱い）かつ最小 positionId が前進しない異常レスポンス。
      // prevId が単調減少しないとカーソルが終端せず暴走するため fail-fast する。
      const stuckPage = makeOpenPositionsPageResponse(
        Array.from({ length: 100 }, () => 500), // 全件同一 positionId → min が減らない
      );
      vi.mocked(restClient.get).mockResolvedValue(stuckPage);

      // When / Then: NETWORK_ERROR 等への再分類を弾くため code まで検証する
      const error = await broker
        .fetchOpenPositionIds(CurrencyPair('USD_JPY'))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BrokerError);
      expect((error as BrokerError).code).toBe('UNEXPECTED');
    });

    it('ページ数が上限を超え続ける場合 BrokerError.unexpected を throw する', async () => {
      // Given: 毎ページ満杯かつカーソルが必ず前進する（=正常に見えるが終端しない）レスポンス。
      // 100 件のうち最小 positionId を呼び出しごとに 1 ずつ下げて、終端しない状況を作る。
      let base = 1_000_000;
      vi.mocked(restClient.get).mockImplementation(async () => {
        const page = makeOpenPositionsPageResponse(
          Array.from({ length: 100 }, (_, i) => base - i),
        );
        base -= 100;
        return page;
      });

      // When / Then: ページ上限超過で fail-fast。NETWORK_ERROR 等への再分類を弾くため code まで検証する
      const error = await broker
        .fetchOpenPositionIds(CurrencyPair('USD_JPY'))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BrokerError);
      expect((error as BrokerError).code).toBe('UNEXPECTED');
    });

    it('建玉がページ上限 * ページサイズ件ちょうど（全ページ満杯）でも終端を確認して全件返す', async () => {
      // Given: 上限 100 ページがすべて満杯（100 件）で、件数が 100 で割り切れるため
      // 最終ページが部分ページにならない。終端確認の追加 1 ページ（空）が必要になる。
      // ガードが 1 リクエスト早く発火すると、全件取得済みなのに UNEXPECTED で失敗する。
      let base = 1_000_000;
      let call = 0;
      vi.mocked(restClient.get).mockImplementation(async () => {
        call += 1;
        if (call <= 100) {
          const page = makeOpenPositionsPageResponse(
            Array.from({ length: 100 }, (_, i) => base - i),
          );
          base -= 100;
          return page;
        }
        // 101 回目: 終端確認の空ページ
        return makeOpenPositionsPageResponse([]);
      });

      // When
      const ids = await broker.fetchOpenPositionIds(CurrencyPair('USD_JPY'));

      // Then: 100 ページ分 + 終端確認の 1 回 = 101 回取得し、全 10000 件を返す
      expect(vi.mocked(restClient.get)).toHaveBeenCalledTimes(101);
      expect(ids).toHaveLength(10000);
    });

    it('建玉が 1 件もなければ空配列を返す', async () => {
      // Given: data.list が無いレスポンス（GMO は建玉ゼロのとき list を返さない）
      vi.mocked(restClient.get).mockResolvedValueOnce({ status: 0, data: {}, responsetime: '' });

      // When / Then
      expect(await broker.fetchOpenPositionIds(CurrencyPair('USD_JPY'))).toEqual([]);
    });

    it('GMO API エラーは BrokerError に変換して throw する', async () => {
      // Given
      vi.mocked(restClient.get).mockRejectedValueOnce(
        new GmoApiError(1, [{ message_code: 'ERR-5012', message_string: '認証エラー' }]),
      );

      // When / Then
      await expect(
        broker.fetchOpenPositionIds(CurrencyPair('USD_JPY')),
      ).rejects.toBeInstanceOf(BrokerError);
    });

    it('GMO API 以外のエラーは BrokerError.networkError に変換して throw する', async () => {
      // Given: ネットワーク断などの GmoApiError でない例外
      vi.mocked(restClient.get).mockRejectedValueOnce(new Error('Network timeout'));

      // When / Then
      await expect(
        broker.fetchOpenPositionIds(CurrencyPair('USD_JPY')),
      ).rejects.toMatchObject({ name: 'BrokerError', code: 'NETWORK_ERROR' });
    });
  });

  describe('verifyConnectivity()', () => {
    it('account/assets を叩いて結線を確認する', async () => {
      // Given: 成功（status 0）
      vi.mocked(restClient.get).mockResolvedValueOnce({
        status: 0,
        data: [{ equity: '100000' }],
        responsetime: '',
      });

      // When
      await broker.verifyConnectivity();

      // Then: private API を 1 本叩いている
      expect(vi.mocked(restClient.get)).toHaveBeenCalledWith('/private/v1/account/assets');
    });

    it('認証失敗（ERR-5012）は BrokerError.authenticationFailed に変換して throw する', async () => {
      // Given: 壊れた API キーでの認証エラー（#287 の ERR-5012 相当）
      vi.mocked(restClient.get).mockRejectedValueOnce(
        new GmoApiError(5, [{ message_code: 'ERR-5012', message_string: '認証エラー' }]),
      );

      // When / Then
      await expect(broker.verifyConnectivity()).rejects.toMatchObject({
        name: 'BrokerError',
        code: 'AUTHENTICATION_FAILED',
      });
    });

    it('レート制限（status=4）は BrokerError.rateLimited に変換する（認証失敗と誤報しない）', async () => {
      // Given: 起動直後の一過性レート制限。鍵は正しい
      vi.mocked(restClient.get).mockRejectedValueOnce(
        new GmoApiError(4, [{ message_code: 'ERR-5003', message_string: 'レート制限超過' }]),
      );

      // When / Then: 認証失敗ではなくレート制限として報告する
      await expect(broker.verifyConnectivity()).rejects.toMatchObject({
        name: 'BrokerError',
        code: 'RATE_LIMITED',
      });
    });

    it('認証以外の GMO API エラーは BrokerError.unexpected に変換する', async () => {
      // Given: サーバ側障害など認証でもレート制限でもない API エラー
      vi.mocked(restClient.get).mockRejectedValueOnce(
        new GmoApiError(1, [{ message_code: 'ERR-9999', message_string: 'サーバエラー' }]),
      );

      // When / Then
      await expect(broker.verifyConnectivity()).rejects.toMatchObject({
        name: 'BrokerError',
        code: 'UNEXPECTED',
      });
    });

    it('GMO API 以外のエラーは BrokerError.networkError に変換して throw する', async () => {
      // Given: ネットワーク断
      vi.mocked(restClient.get).mockRejectedValueOnce(new Error('Network timeout'));

      // When / Then
      await expect(broker.verifyConnectivity()).rejects.toMatchObject({
        name: 'BrokerError',
        code: 'NETWORK_ERROR',
      });
    });
  });
});
