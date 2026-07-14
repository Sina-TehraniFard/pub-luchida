import { describe, it, expect } from 'vitest';

import { Price } from '@luchida/backend/domain/market/Price.js';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import { ConfirmedCandle } from '@luchida/backend/domain/market/candle/ConfirmedCandle.js';
import { CandleOpenTime } from '@luchida/backend/domain/market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '@luchida/backend/domain/market/candle/CandleCloseTime.js';
import { Lot } from '@luchida/backend/domain/position/Lot.js';
import { BacktestSizingResult } from '@luchida/backend/domain/position/BacktestSizingResult.js';
import { SmaCrossEntryRule } from '@luchida/backend/domain/rule/sma-cross/SmaCrossEntryRule.js';
import { SmaCrossExitRule } from '@luchida/backend/domain/rule/sma-cross/SmaCrossExitRule.js';

import { OhlcEngine } from './OhlcEngine.js';
import { IdealExecutionSimulator } from '../simulator/IdealExecutionSimulator.js';
import { BacktestSnapshotAdapter } from '../snapshot-adapter/BacktestSnapshotAdapter.js';
import { BacktestSmaCalculatorFactory } from '../snapshot-adapter/BacktestSmaCalculatorFactory.js';
import type { DataProvider } from '../data-provider/DataProvider.js';
import type { EngineRunParams } from './Engine.js';

const pair = CurrencyPair('USD_JPY');
const tf = TimeFrame.FIFTEEN_MINUTE;
const SHORT_PERIOD = 3;
const LONG_PERIOD = 5;

/**
 * ゴールデンクロス → デッドクロスが起きる足データを生成する。
 *
 * 前半は漸減（短期 < 長期）、後半は急上昇（短期 > 長期 = GC）、
 * その後に急降下（短期 < 長期 = DC）。
 */
function makeGoldenDeadCrossCandles(): ConfirmedCandle[] {
  const candles: ConfirmedCandle[] = [];
  const baseTime = new Date('2024-01-01T00:00:00Z');
  // 安定期: 短期 < 長期（SMA(3) < SMA(5)）を作るため漸減
  const prices = [
    150.10, 150.08, 150.06, 150.04, 150.02, 150.00, 149.98,
    // ゴールデンクロス: 急上昇
    150.20, 150.40, 150.60,
    // デッドクロス: 急降下
    150.30, 150.00, 149.80, 149.60,
    // 余白
    149.50,
  ];

  for (let i = 0; i < prices.length; i++) {
    const close = prices[i]!;
    const openMs = baseTime.getTime() + i * 900_000;
    candles.push(
      ConfirmedCandle.of({
        open: Price.of((close - 0.01).toFixed(3)),
        high: Price.of((close + 0.05).toFixed(3)),
        low: Price.of((close - 0.05).toFixed(3)),
        close: Price.of(close.toFixed(3)),
        openTime: CandleOpenTime.of(new Date(openMs)),
        closeTime: CandleCloseTime.of(new Date(openMs + 900_000)),
        timeFrame: tf,
      }),
    );
  }
  return candles;
}

function fakeDataProvider(candles: ConfirmedCandle[]): DataProvider {
  return {
    fetchCandles: async () => candles,
    async *fetchTicks() { /* noop */ },
  };
}

describe('OhlcEngine Integration', () => {
  it('SmaCrossEntryRule + ExitRule + IdealExecutionSimulator で E2E 実行', async () => {
    const candles = makeGoldenDeadCrossCandles();
    const engine = new OhlcEngine();
    const factory = new BacktestSmaCalculatorFactory();

    const params: EngineRunParams = {
      config: {
        pair,
        timeframe: tf,
        dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') },
        warmupCount: LONG_PERIOD + 1,
      },
      entryRule: new SmaCrossEntryRule(tf, () => BacktestSizingResult.of(Lot.of(1000), pair)),
      exitRule: new SmaCrossExitRule(tf),
      dataProvider: fakeDataProvider(candles),
      snapshotAdapter: BacktestSnapshotAdapter.singleTimeFrame(pair, tf, SHORT_PERIOD, LONG_PERIOD, factory),
      executionSimulator: new IdealExecutionSimulator(),
      runId: 'integration-run',
      batchId: 'integration-batch',
      strategy: 'SMA_CROSS',
      params: { shortPeriod: SHORT_PERIOD, longPeriod: LONG_PERIOD },
      equityState: null,
      marketState: null,
      initialCapital: 100_000,
      engineMode: 'OHLC',
      executionConfig: { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 },
      codeVersion: 'test',
    };

    const result = await engine.run(params);

    // BT が正常に完了して BacktestResult が返る
    expect(result.id).toBe('integration-run');
    expect(result.strategy).toBe('SMA_CROSS');
    expect(result.pair).toBe('USD_JPY');

    // 1つ以上のトレードが記録される（GC でエントリー → DC or FORCE_CLOSE で決済）
    expect(result.trades.length).toBeGreaterThanOrEqual(1);

    // トレードに必須フィールドが存在する
    const trade = result.trades[0]!;
    expect(trade.entryPrice).toBeGreaterThan(0);
    expect(trade.exitPrice).toBeGreaterThan(0);
    expect(trade.holdingPeriodMs).toBeGreaterThan(0);
    expect(trade.side).toBe('BUY'); // GC → BUY

    // ResultCalculator の指標が計算されている
    expect(result.tradeCount).toBe(result.trades.length);
  });
});
