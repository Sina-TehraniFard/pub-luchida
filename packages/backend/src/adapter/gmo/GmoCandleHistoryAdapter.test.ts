import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GmoCandleHistoryAdapter } from './GmoCandleHistoryAdapter.js';
import { TimeFrame } from '../../domain/market/TimeFrame.js';
import { MarketDataError } from '../../domain/error/MarketDataError.js';
import type { GmoRestClient } from './GmoRestClient.js';
import type { Clock } from '../../port/Clock.js';
import { CurrencyPair } from '../../domain/market/CurrencyPair.js';

// Logger 出力を抑制
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const makeKlineData = (openTimeMs: number, price: string = '150.000') => ({
  openTime: String(openTimeMs),
  open: price,
  high: price,
  low: price,
  close: price,
});

const makeResponse = (data: unknown[]) => ({
  status: 0,
  data,
  responsetime: '2026-03-29T10:00:00.000Z',
});

/** 固定時刻を返す Fake Clock */
const fixedClock = (ms: number): Clock => ({ now: () => new Date(ms) });

describe('GmoCandleHistoryAdapter', () => {
  let restClient: GmoRestClient;
  let adapter: GmoCandleHistoryAdapter;
  // テスト基準時刻。klines はこれより前に閉じた足＝確定足として扱われる。
  const NOW = new Date('2026-03-29T12:00:00.000Z').getTime();

  beforeEach(() => {
    restClient = {
      publicGet: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
    } as unknown as GmoRestClient;
    adapter = new GmoCandleHistoryAdapter(restClient, fixedClock(NOW));
  });

  describe('fetchRecent()', () => {
    it('1分足のローソク足を取得して ConfirmedCandle に変換する', async () => {
      // Given: NOW より前に閉じた確定足を返す
      const klines = [
        makeKlineData(NOW - 180_000, '150.000'), // 3分前始（2分前に確定）
        makeKlineData(NOW - 120_000, '150.100'), // 2分前始（1分前に確定）
      ];
      vi.mocked(restClient.publicGet)
        .mockResolvedValueOnce(makeResponse(klines))
        .mockResolvedValue(makeResponse([]));

      // When: 1分足2本を取得
      const candles = await adapter.fetchRecent(TimeFrame.ONE_MINUTE, 2);

      // Then: 2本の ConfirmedCandle が古い順に返る
      expect(candles).toHaveLength(2);
      expect(candles[0].open.toString()).toBe('150');    // 2分前（古い方）
      expect(candles[1].open.toString()).toBe('150.1');  // 1分前（新しい方）
      expect(candles[0].timeFrame).toBe(TimeFrame.ONE_MINUTE);
    });

    it('要求した本数に切り詰める', async () => {
      // Given: 5本分の確定足がある（NOW より前に閉じている）
      const klines = Array.from({ length: 5 }, (_, i) =>
        makeKlineData(NOW - (6 - i) * 60_000, '150.000'),
      );
      vi.mocked(restClient.publicGet).mockResolvedValue(makeResponse(klines));

      // When: 3本だけ要求
      const candles = await adapter.fetchRecent(TimeFrame.ONE_MINUTE, 3);

      // Then: 3本に切り詰められている
      expect(candles).toHaveLength(3);
    });

    it('GMO interval マッピングが正しい', async () => {
      // Given: NOW より前に閉じた1時間足（確定足）
      vi.mocked(restClient.publicGet).mockResolvedValue(
        makeResponse([makeKlineData(NOW - 3_600_000)]),
      );

      // When: 1時間足を取得
      await adapter.fetchRecent(TimeFrame.ONE_HOUR, 1);

      // Then: interval=1hour で呼ばれている
      expect(restClient.publicGet).toHaveBeenCalledWith(
        '/public/v1/klines',
        expect.objectContaining({ interval: '1hour' }),
      );
    });

    it('日足は interval=1day で取得する', async () => {
      vi.mocked(restClient.publicGet).mockResolvedValue(
        makeResponse([makeKlineData(NOW - 86_400_000)]),
      );

      await adapter.fetchRecent(TimeFrame.ONE_DAY, 1);

      expect(restClient.publicGet).toHaveBeenCalledWith(
        '/public/v1/klines',
        expect.objectContaining({ interval: '1day' }),
      );
    });

    it('データが0本の場合 MarketDataError を throw する', async () => {
      // Given: 空のレスポンス
      vi.mocked(restClient.publicGet).mockResolvedValue(makeResponse([]));

      // When & Then
      await expect(
        adapter.fetchRecent(TimeFrame.ONE_MINUTE, 5),
      ).rejects.toThrow(MarketDataError);
    });

    it('closeTime が openTime + duration - 1ms になる', async () => {
      // Given: openTime が明確な1分足データ
      const openTimeMs = new Date('2026-03-29T10:00:00.000Z').getTime();
      vi.mocked(restClient.publicGet).mockResolvedValue(
        makeResponse([makeKlineData(openTimeMs)]),
      );

      // When: 取得
      const candles = await adapter.fetchRecent(TimeFrame.ONE_MINUTE, 1);

      // Then: closeTime = openTime + 60_000 - 1
      const expectedCloseMs = openTimeMs + 60_000 - 1;
      expect(candles[0].closeTime.toDate().getTime()).toBe(expectedCloseMs);
    });

    it('既定では USD_JPY を symbol に使う', async () => {
      vi.mocked(restClient.publicGet).mockResolvedValue(
        makeResponse([makeKlineData(NOW - 60_000)]),
      );

      await adapter.fetchRecent(TimeFrame.ONE_MINUTE, 1);

      expect(restClient.publicGet).toHaveBeenCalledWith(
        '/public/v1/klines',
        expect.objectContaining({ symbol: 'USD_JPY' }),
      );
    });

    it('コンストラクタで渡したペアを symbol に使う', async () => {
      const eurUsdAdapter = new GmoCandleHistoryAdapter(
        restClient,
        fixedClock(NOW),
        CurrencyPair('EUR_USD'),
      );
      vi.mocked(restClient.publicGet).mockResolvedValue(
        makeResponse([makeKlineData(NOW - 60_000)]),
      );

      await eurUsdAdapter.fetchRecent(TimeFrame.ONE_MINUTE, 1);

      expect(restClient.publicGet).toHaveBeenCalledWith(
        '/public/v1/klines',
        expect.objectContaining({ symbol: 'EUR_USD' }),
      );
    });

    it('末尾の未確定足（closeTime が現在より未来）を確定足として返さない', async () => {
      // Given: NOW=12:00。GMO は末尾に「11:59 開始の形成中足」を含めて返す（1分足）。
      //   11:58足: closeTime=11:58:59.999 ← 確定（NOW より前）
      //   11:59足: closeTime=11:59:59.999 ← 確定（NOW=12:00:00.000 より前）
      //   12:00足: openTime=NOW、closeTime=12:00:59.999 ← 未確定（NOW より未来）
      const confirmedOpen = NOW - 120_000; // 11:58:00
      const justClosedOpen = NOW - 60_000; // 11:59:00（closeTime=11:59:59.999 < NOW）
      const formingOpen = NOW;             // 12:00:00（closeTime=12:00:59.999 > NOW）
      vi.mocked(restClient.publicGet)
        .mockResolvedValueOnce(
          makeResponse([
            makeKlineData(confirmedOpen, '150.000'),
            makeKlineData(justClosedOpen, '150.100'),
            makeKlineData(formingOpen, '150.200'),
          ]),
        )
        .mockResolvedValue(makeResponse([]));

      // When
      const candles = await adapter.fetchRecent(TimeFrame.ONE_MINUTE, 10);

      // Then: 形成中の 12:00 足は除外され、確定足2本だけが古い順で返る
      expect(candles).toHaveLength(2);
      expect(candles[0].openTime.toDate().getTime()).toBe(confirmedOpen);
      expect(candles[1].openTime.toDate().getTime()).toBe(justClosedOpen);
      expect(candles[candles.length - 1].close.toString()).toBe('150.1');
    });
  });
});
