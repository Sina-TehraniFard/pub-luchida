import { describe, it, expect } from 'vitest';
import { GmoRestClient } from '../../../src/adapter/gmo/GmoRestClient.js';
import { GmoCandleHistoryAdapter } from '../../../src/adapter/gmo/GmoCandleHistoryAdapter.js';
import { TimeFrame } from '../../../src/domain/market/TimeFrame.js';

/**
 * 結合テスト: GmoCandleHistoryAdapter → GMO FX Public REST API（実接続）
 *
 * 実行条件:
 * - npm run test:integration で実行
 * - Public API なので認証不要
 */
describe('GmoCandleHistoryAdapter 結合テスト', () => {
  const client = new GmoRestClient('', '');
  const adapter = new GmoCandleHistoryAdapter(client);

  it('1分足のローソク足を取得できる', async () => {
    // When: 直近5本の1分足を取得
    const candles = await adapter.fetchRecent(TimeFrame.ONE_MINUTE, 5);

    // Then: ConfirmedCandle が返る
    expect(candles.length).toBeGreaterThan(0);
    expect(candles.length).toBeLessThanOrEqual(5);
    expect(candles[0].timeFrame).toBe(TimeFrame.ONE_MINUTE);

    // OHLC の値が正の数である
    for (const candle of candles) {
      expect(Number(candle.open.toString())).toBeGreaterThan(0);
      expect(Number(candle.high.toString())).toBeGreaterThan(0);
    }
  });

  it('日足のローソク足を取得できる', async () => {
    const candles = await adapter.fetchRecent(TimeFrame.ONE_DAY, 3);

    expect(candles.length).toBeGreaterThan(0);
    expect(candles[0].timeFrame).toBe(TimeFrame.ONE_DAY);
  });
});
