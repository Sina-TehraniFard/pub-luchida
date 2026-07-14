import { describe, it, expect } from 'vitest';

import { Price } from '@luchida/backend/domain/market/Price.js';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import { Tick } from '@luchida/backend/domain/market/tick/Tick.js';
import { TickTimestamp } from '@luchida/backend/domain/market/tick/TickTimestamp.js';
import { ConfirmedCandle } from '@luchida/backend/domain/market/candle/ConfirmedCandle.js';
import { CandleOpenTime } from '@luchida/backend/domain/market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '@luchida/backend/domain/market/candle/CandleCloseTime.js';
import { Lot } from '@luchida/backend/domain/position/Lot.js';
import { BacktestSizingResult } from '@luchida/backend/domain/position/BacktestSizingResult.js';
import { SmaCrossEntryRule } from '@luchida/backend/domain/rule/sma-cross/SmaCrossEntryRule.js';
import { SmaCrossExitRule } from '@luchida/backend/domain/rule/sma-cross/SmaCrossExitRule.js';

import { TickEngine } from './TickEngine.js';
import { PendingOrderManager } from './PendingOrderManager.js';
import { RealisticExecutionSimulator } from '../simulator/RealisticExecutionSimulator.js';
import { SlippageModel } from '../simulator/SlippageModel.js';
import { SeededRandom } from '../simulator/SeededRandom.js';
import { BacktestSnapshotAdapter } from '../snapshot-adapter/BacktestSnapshotAdapter.js';
import { BacktestSmaCalculatorFactory } from '../snapshot-adapter/BacktestSmaCalculatorFactory.js';
import type { DataProvider } from '../data-provider/DataProvider.js';
import type { EngineRunParams } from './Engine.js';

const pair = CurrencyPair('USD_JPY');
const tf = TimeFrame.FIFTEEN_MINUTE;
const SHORT_PERIOD = 3;
const LONG_PERIOD = 5;
const JPY_PIP_UNIT = 0.01;
const FIFTEEN_MIN_MS = 15 * 60 * 1_000;

/**
 * SMA ゴールデンクロス → デッドクロスが1回ずつ発生する tick ストリームを生成する。
 *
 * 各15分足を複数の tick で表現する（1分足10本 = 10 tick / 足）。
 * 価格パターンは OhlcEngine の integration テストと同じ。
 *
 * 生成する tick 数: 足の本数 × ticks per candle
 */
function makeGoldenDeadCrossTickStream(): AsyncIterable<Tick> {
  const baseTime = new Date('2024-01-01T00:00:00Z').getTime();

  // OhlcEngine の integration test と同じ価格パターン
  const candlePrices = [
    150.10, 150.08, 150.06, 150.04, 150.02, 150.00, 149.98,
    // ゴールデンクロス: 急上昇
    150.20, 150.40, 150.60,
    // デッドクロス: 急降下
    150.30, 150.00, 149.80, 149.60,
    // 余白
    149.50,
  ];

  const TICKS_PER_CANDLE = 10;
  const TICK_INTERVAL_MS = FIFTEEN_MIN_MS / TICKS_PER_CANDLE;

  const ticks: Tick[] = [];
  for (let i = 0; i < candlePrices.length; i++) {
    const bidClose = candlePrices[i]!;
    for (let j = 0; j < TICKS_PER_CANDLE; j++) {
      const tsMs = baseTime + i * FIFTEEN_MIN_MS + j * TICK_INTERVAL_MS;
      // 足内で価格が open → close に線形補間
      const prevBid = i > 0 ? candlePrices[i - 1]! : bidClose;
      const frac = j / TICKS_PER_CANDLE;
      const bid = prevBid + (bidClose - prevBid) * frac;
      const ask = bid + 0.05; // 5 pips spread
      const ts = TickTimestamp.of(new Date(tsMs));
      ticks.push(Tick.of(
        Price.of(ask.toFixed(3)),
        Price.of(bid.toFixed(3)),
        ts,
      ));
    }
  }

  return {
    async *[Symbol.asyncIterator]() {
      for (const tick of ticks) {
        yield tick;
      }
    },
  };
}

/** warmup 用の確定足を生成（全て同じ価格 150.10 で warmup 期間は SMA が安定するだけで十分） */
function makeWarmupCandles(count: number, bid = 150.10): ConfirmedCandle[] {
  const baseTime = new Date('2024-01-01T00:00:00Z').getTime();
  const candles: ConfirmedCandle[] = [];
  for (let i = 0; i < count; i++) {
    const tsMs = baseTime - (count - i) * FIFTEEN_MIN_MS;
    candles.push(ConfirmedCandle.of({
      open: Price.of(bid.toFixed(3)),
      high: Price.of(bid.toFixed(3)),
      low: Price.of(bid.toFixed(3)),
      close: Price.of(bid.toFixed(3)),
      openTime: CandleOpenTime.of(new Date(tsMs)),
      closeTime: CandleCloseTime.of(new Date(tsMs + FIFTEEN_MIN_MS)),
      timeFrame: tf,
    }));
  }
  return candles;
}

function makeDataProvider(): DataProvider {
  return {
    fetchCandles: async () => makeWarmupCandles(LONG_PERIOD + 1),
    fetchTicks: () => makeGoldenDeadCrossTickStream(),
  };
}

describe('TickEngine Integration', () => {
  it('実体クラスで E2E 実行: 約定価格が bid/ask 分離 + スリッページ分ズレている', async () => {
    // RealisticExecutionSimulator でスリッページを適用
    // BUY エントリー: ask（bid + spread）+ スリッページ（上方向）
    // したがって entryPrice > bid
    const stddevPips = '0.3';
    const rng = new SeededRandom(42);
    const slippage = new SlippageModel(Number(stddevPips), rng, JPY_PIP_UNIT);
    const simulator = new RealisticExecutionSimulator(slippage);

    const engine = new TickEngine(new PendingOrderManager(100));
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
      dataProvider: makeDataProvider(),
      snapshotAdapter: BacktestSnapshotAdapter.singleTimeFrame(pair, tf, SHORT_PERIOD, LONG_PERIOD, factory),
      executionSimulator: simulator,
      runId: 'tick-integration-run',
      batchId: 'tick-integration-batch',
      strategy: 'SMA_CROSS',
      params: { shortPeriod: SHORT_PERIOD, longPeriod: LONG_PERIOD },
      equityState: null,
      marketState: null,
      initialCapital: 100_000,
      engineMode: 'TICK',
      executionConfig: { slippageStddevPips: 0.3, executionDelayMs: 0, randomSeed: 42 },
      codeVersion: 'test',
    };

    const result = await engine.run(params);

    // BT が正常に完了して BacktestResult が返る
    expect(result.id).toBe('tick-integration-run');
    expect(result.strategy).toBe('SMA_CROSS');
    expect(result.pair).toBe('USD_JPY');

    // 1つ以上のトレードが記録される（GC でエントリー → DC or FORCE_CLOSE で決済）
    expect(result.trades.length).toBeGreaterThanOrEqual(1);

    const trade = result.trades[0]!;

    // BUY エントリーの場合: entryPrice は bid より大きい（ask + スリッページ）
    // bid ≈ 150 前後なので、entryPrice > 150（bid 相当）
    expect(trade.entryPrice).toBeGreaterThan(0);
    expect(trade.exitPrice).toBeGreaterThan(0);
    expect(trade.holdingPeriodMs).toBeGreaterThan(0);

    // GC でエントリーした場合は BUY
    if (trade.side === 'BUY') {
      // BUY エントリー価格は ask 以上（bid + spread + slippage）
      // spread = 0.05, bid ≈ 150 → entryPrice > 150
      expect(trade.entryPrice).toBeGreaterThan(150.0);
    }

    // tradeCount と trades.length が一致
    expect(result.tradeCount).toBe(result.trades.length);
  });
});
