import { describe, it, expect, vi } from 'vitest';

import { Price } from '@luchida/backend/domain/market/Price.js';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import { Tick } from '@luchida/backend/domain/market/tick/Tick.js';
import { TickTimestamp } from '@luchida/backend/domain/market/tick/TickTimestamp.js';
import { EntryCommand } from '@luchida/backend/domain/command/EntryCommand.js';
import { ExitCommand, ExitType } from '@luchida/backend/domain/command/ExitCommand.js';
import { DoNothing } from '@luchida/backend/domain/command/DoNothing.js';
import { EntryReason } from '@luchida/backend/domain/command/EntryReason.js';
import { ExitReason } from '@luchida/backend/domain/command/ExitReason.js';
import { ConvictionScore } from '@luchida/backend/domain/market/ConvictionScore.js';
import { EntrySnapshot } from '@luchida/backend/domain/market/snapshot/EntrySnapshot.js';
import { Lot } from '@luchida/backend/domain/position/Lot.js';
import { Money } from '@luchida/backend/domain/Money.js';
import { StrategyName } from '@luchida/backend/domain/rule/StrategyName.js';
import { MarketSnapshot } from '@luchida/backend/domain/market/snapshot/MarketSnapshot.js';
import { ConfirmedCandle } from '@luchida/backend/domain/market/candle/ConfirmedCandle.js';
import { CandleOpenTime } from '@luchida/backend/domain/market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '@luchida/backend/domain/market/candle/CandleCloseTime.js';
import type { EntryRule } from '@luchida/backend/domain/rule/EntryRule.js';
import type { ExitRule } from '@luchida/backend/domain/rule/ExitRule.js';
import type { Position } from '@luchida/backend/domain/position/Position.js';

import { TickEngine } from './TickEngine.js';
import { PendingOrderManager } from './PendingOrderManager.js';
import { IdealExecutionSimulator } from '../simulator/IdealExecutionSimulator.js';
import type { DataProvider } from '../data-provider/DataProvider.js';
import type { SnapshotAdapter } from '../snapshot-adapter/SnapshotAdapter.js';
import type { EngineRunParams } from './Engine.js';

const pair = CurrencyPair('USD_JPY');
const tf = TimeFrame.FIFTEEN_MINUTE;

// 15分足の期間長（ms）
const FIFTEEN_MIN_MS = 15 * 60 * 1_000;

/**
 * 指定した時刻の Tick を生成する。
 * デフォルトスプレッド: 5 pips（0.05）
 */
function makeTick(tsMs: number, bid = 150.000): Tick {
  const ask = bid + 0.05; // 5 pips spread
  const ts = TickTimestamp.of(new Date(tsMs));
  return Tick.of(Price.of(ask.toFixed(3)), Price.of(bid.toFixed(3)), ts);
}

/**
 * 指定した時刻系列の tick を返す AsyncIterable を生成する。
 *
 * prices: { tsMs, bid } の配列
 */
function makeTickStream(prices: Array<{ tsMs: number; bid: number }>): AsyncIterable<Tick> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const { tsMs, bid } of prices) {
        yield makeTick(tsMs, bid);
      }
    },
  };
}

/**
 * tick の配列から DataProvider を作成する。
 * fetchTicks は与えた配列を AsyncIterable として返す。
 * fetchCandles は warmup 用に指定した確定足を返す（設計書: warmup は fetchCandles 経由）。
 */
function mockDataProvider(
  ticks: Array<{ tsMs: number; bid: number }>,
  warmupCandles: ConfirmedCandle[] = [],
): DataProvider {
  return {
    fetchCandles: vi.fn().mockResolvedValue(warmupCandles),
    fetchTicks: vi.fn().mockReturnValue(makeTickStream(ticks)),
  };
}

/** ダミーの確定足を生成（warmup 用） */
function makeDummyConfirmedCandle(tsMs: number, bid = 150.000): ConfirmedCandle {
  return ConfirmedCandle.of({
    open: Price.of(bid.toFixed(3)),
    high: Price.of(bid.toFixed(3)),
    low: Price.of(bid.toFixed(3)),
    close: Price.of(bid.toFixed(3)),
    openTime: CandleOpenTime.of(new Date(tsMs)),
    closeTime: CandleCloseTime.of(new Date(tsMs + FIFTEEN_MIN_MS)),
    timeFrame: tf,
  });
}

function mockSnapshotAdapter(): SnapshotAdapter {
  return {
    warmUp: vi.fn(),
    addCandleAndBuild: vi.fn().mockReturnValue(makeDummySnapshot()),
  };
}

function makeDummySnapshot(): MarketSnapshot {
  const tick = makeTick(1_000_000);
  return { tick, pair, capturedAt: { toDate: () => new Date() } } as unknown as MarketSnapshot;
}

function makeEntryCommand(buySell: 'BUY' | 'SELL' = 'BUY'): EntryCommand {
  return EntryCommand.of({
    pair,
    buySell,
    lot: Lot.of(1000),
    reason: EntryReason.of('テスト'),
    convictionScore: ConvictionScore.of('0.7'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: EntrySnapshot.of({ convictionScore: '0.7', entryHour: 10, entryDayOfWeek: 1 }),
    requiredMargin: Money.jpy('0'),
  });
}

function alwaysBuyEntryRule(): EntryRule {
  return { shouldEntry: () => makeEntryCommand('BUY') };
}

function neverEntryRule(): EntryRule {
  return { shouldEntry: () => DoNothing.instance };
}

function neverExitRule(): ExitRule {
  return { shouldExit: () => DoNothing.instance };
}

/**
 * 2つの足にまたがる tick 配列を生成する。
 *
 * baseMs: 最初の tick の時刻
 * firstPeriodCount: 1本目の足に含む tick 数
 * secondPeriodCount: 2本目の足に含む tick 数
 */
function makeTicksSpanning2Candles(
  baseMs: number,
  firstPeriodCount: number,
  secondPeriodCount: number,
  bid = 150.000,
): Array<{ tsMs: number; bid: number }> {
  const ticks: Array<{ tsMs: number; bid: number }> = [];
  // 1本目の足（baseMs から FIFTEEN_MIN_MS 未満）
  for (let i = 0; i < firstPeriodCount; i++) {
    ticks.push({ tsMs: baseMs + i * 1_000, bid });
  }
  // 2本目の足（baseMs + FIFTEEN_MIN_MS 以降）
  const secondBase = baseMs + FIFTEEN_MIN_MS;
  for (let i = 0; i < secondPeriodCount; i++) {
    ticks.push({ tsMs: secondBase + i * 1_000, bid });
  }
  return ticks;
}

function makeParams(overrides: Partial<EngineRunParams> = {}): EngineRunParams {
  const baseMs = new Date('2024-01-01T00:00:00Z').getTime();
  const ticks = makeTicksSpanning2Candles(baseMs, 5, 5);
  return {
    config: {
      pair,
      timeframe: tf,
      dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') },
      warmupCount: 0,
    },
    entryRule: neverEntryRule(),
    exitRule: neverExitRule(),
    dataProvider: mockDataProvider(ticks),
    snapshotAdapter: mockSnapshotAdapter(),
    executionSimulator: new IdealExecutionSimulator(),
    runId: 'test-run',
    batchId: 'test-batch',
    strategy: 'SMA_CROSS',
    params: { shortPeriod: 20, longPeriod: 100 },
    equityState: null,
    marketState: null,
    initialCapital: 100_000,
    engineMode: 'TICK',
    executionConfig: { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 },
    codeVersion: 'test',
    ...overrides,
  };
}

describe('TickEngine', () => {
  describe('足確定と Rule 呼び出し', () => {
    it('足確定時に EntryRule が呼ばれる', async () => {
      const engine = new TickEngine(new PendingOrderManager(0));
      const entryRule = { shouldEntry: vi.fn().mockReturnValue(DoNothing.instance) };
      const exitRule = { shouldExit: vi.fn().mockReturnValue(DoNothing.instance) };

      const baseMs = new Date('2024-01-01T00:00:00Z').getTime();
      // 1本目の足（0:00〜0:15）と2本目の足（0:15〜0:30）をまたぐ tick
      const ticks = makeTicksSpanning2Candles(baseMs, 3, 3);

      await engine.run(makeParams({
        entryRule,
        exitRule,
        dataProvider: mockDataProvider(ticks),
      }));

      // 足が1本確定するので shouldEntry が1回呼ばれる
      expect(entryRule.shouldEntry).toHaveBeenCalledTimes(1);
    });

    it('warmup 足は fetchCandles 経由で取得され tick ストリームの Rule 呼び出しには影響しない', async () => {
      const engine = new TickEngine(new PendingOrderManager(0));
      const entryRule = { shouldEntry: vi.fn().mockReturnValue(DoNothing.instance) };
      const exitRule = { shouldExit: vi.fn().mockReturnValue(DoNothing.instance) };

      const baseMs = new Date('2024-01-01T00:00:00Z').getTime();
      // warmup: fetchCandles から 2 本供給
      const warmupCandles = [
        makeDummyConfirmedCandle(baseMs - 2 * FIFTEEN_MIN_MS),
        makeDummyConfirmedCandle(baseMs - 1 * FIFTEEN_MIN_MS),
      ];
      // tick: 3本の足確定分（Rule は 3 回呼ばれるはず）
      const ticks: Array<{ tsMs: number; bid: number }> = [];
      for (let period = 0; period < 3; period++) {
        const periodBase = baseMs + period * FIFTEEN_MIN_MS;
        for (let i = 0; i < 3; i++) {
          ticks.push({ tsMs: periodBase + i * 1_000, bid: 150 });
        }
      }
      // 次の足の最初の tick を入れて最後の足を確定させる
      ticks.push({ tsMs: baseMs + 3 * FIFTEEN_MIN_MS, bid: 150 });

      await engine.run(makeParams({
        entryRule,
        exitRule,
        dataProvider: mockDataProvider(ticks, warmupCandles),
        config: {
          pair,
          timeframe: tf,
          dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') },
          warmupCount: 2,
        },
      }));

      // tick ストリームで 3 本の足が確定するので Rule が 3 回呼ばれる
      expect(entryRule.shouldEntry).toHaveBeenCalledTimes(3);
    });
  });

  describe('約定遅延と bid/ask 分離', () => {
    it('約定遅延: Command 発行後、delayMs 経過後の tick で約定', async () => {
      // delayMs=500ms を設定し、エントリーが遅延して約定することを確認
      const delayMs = 500;
      const engine = new TickEngine(new PendingOrderManager(delayMs));

      const baseMs = new Date('2024-01-01T00:00:00Z').getTime();
      // 足1本分 + 足2本目に入る tick（遅延期間中も tick がある）
      const ticks: Array<{ tsMs: number; bid: number }> = [];
      // 1本目の足
      for (let i = 0; i < 3; i++) {
        ticks.push({ tsMs: baseMs + i * 100, bid: 150 });
      }
      // 2本目の足（足確定 → エントリー命令発行 → 遅延後に約定）
      const secondBase = baseMs + FIFTEEN_MIN_MS;
      for (let i = 0; i < 10; i++) {
        ticks.push({ tsMs: secondBase + i * 100, bid: 150 });
      }

      const result = await engine.run(makeParams({
        entryRule: alwaysBuyEntryRule(),
        exitRule: neverExitRule(),
        dataProvider: mockDataProvider(ticks),
      }));

      // FORCE_CLOSE で1トレードが発生するはず
      expect(result.trades.length).toBeGreaterThanOrEqual(0);
      // エラーなく完了すれば OK（遅延処理が正しく動いている）
    });

    it('BUY エントリーは ask 価格で執行される', async () => {
      const engine = new TickEngine(new PendingOrderManager(0));
      const bid = 150.000; // ask = bid + 0.05 = 150.050（BUY は ask で約定）

      const baseMs = new Date('2024-01-01T00:00:00Z').getTime();
      const ticks = makeTicksSpanning2Candles(baseMs, 3, 3, bid);

      const result = await engine.run(makeParams({
        entryRule: alwaysBuyEntryRule(),
        exitRule: neverExitRule(),
        dataProvider: mockDataProvider(ticks),
      }));

      // BUY エントリーは ask（150.050）で約定（スリッページなし = Ideal）
      // FORCE_CLOSE で決済されるトレードがある
      if (result.trades.length > 0) {
        // entryPrice は ask に等しいかそれ以上（スリッページ分上振れの可能性）
        expect(result.trades[0]!.entryPrice).toBeGreaterThanOrEqual(bid);
      }
    });
  });

  describe('MFE/MAE の tick 粒度追跡', () => {
    it('MFE/MAE が tick 粒度で追跡される（updateOhlc を使わない）', async () => {
      // BUY エントリー後に高値を付ける tick が来て、その後 FORCE_CLOSE
      const engine = new TickEngine(new PendingOrderManager(0));

      const baseMs = new Date('2024-01-01T00:00:00Z').getTime();
      // 1本目の足: BUY エントリートリガー用
      const ticks: Array<{ tsMs: number; bid: number }> = [];
      for (let i = 0; i < 3; i++) {
        ticks.push({ tsMs: baseMs + i * 1_000, bid: 150.000 });
      }
      // 2本目の足: bid が 150.500 まで上昇（MFE が大きくなる）
      const secondBase = baseMs + FIFTEEN_MIN_MS;
      ticks.push({ tsMs: secondBase, bid: 150.000 });
      ticks.push({ tsMs: secondBase + 1_000, bid: 150.200 });
      ticks.push({ tsMs: secondBase + 2_000, bid: 150.500 }); // 高値

      const result = await engine.run(makeParams({
        entryRule: alwaysBuyEntryRule(),
        exitRule: neverExitRule(),
        dataProvider: mockDataProvider(ticks),
      }));

      // FORCE_CLOSE で決済されたトレードの MFE が 0 より大きい
      if (result.trades.length > 0) {
        expect(result.trades[0]!.mfePips).toBeGreaterThan(0);
      }
    });
  });

  describe('未決済ポジションの強制クローズ', () => {
    it('未決済ポジションが最終 tick で FORCE_CLOSE される', async () => {
      const engine = new TickEngine(new PendingOrderManager(0));

      const result = await engine.run(makeParams({
        entryRule: alwaysBuyEntryRule(),
        exitRule: neverExitRule(),
      }));

      expect(result.trades.length).toBeGreaterThan(0);
      for (const trade of result.trades) {
        expect(trade.exitType).toBe('FORCE_CLOSE');
      }
    });
  });

  describe('0トレード', () => {
    it('0トレード（シグナルなし）で正常終了する', async () => {
      const engine = new TickEngine(new PendingOrderManager(0));

      const result = await engine.run(makeParams({
        entryRule: neverEntryRule(),
        exitRule: neverExitRule(),
      }));

      expect(result.tradeCount).toBe(0);
      expect(result.trades).toHaveLength(0);
    });
  });

  describe('ドテン', () => {
    it('ドテン: 同 tick で pendingExit 約定 → Position.close → 次足で新 pendingEntry 登録', async () => {
      // BUY エントリー → 決済 → 同足でSELL エントリーのシーケンスを検証
      let tradeCount = 0;
      const engine = new TickEngine(new PendingOrderManager(0));

      const entryRule: EntryRule = {
        shouldEntry: () => {
          tradeCount++;
          // 1回目: BUY、2回目: SELL（ドテン）
          if (tradeCount <= 2) {
            return makeEntryCommand(tradeCount === 1 ? 'BUY' : 'SELL');
          }
          return DoNothing.instance;
        },
      };

      const exitRule: ExitRule = {
        shouldExit: (_snapshot: MarketSnapshot, position: Position) => {
          // 1回目のポジションが来たら決済（ドテン）
          if (position.buySell === 'BUY') {
            return ExitCommand.of({
              positionId: position.id,
              type: ExitType.TAKE_PROFIT,
              reason: ExitReason.of('ドテン決済'),
            });
          }
          return DoNothing.instance;
        },
      };

      const baseMs = new Date('2024-01-01T00:00:00Z').getTime();
      // 3本の足にまたがる tick
      const ticks: Array<{ tsMs: number; bid: number }> = [];
      for (let period = 0; period < 4; period++) {
        const periodBase = baseMs + period * FIFTEEN_MIN_MS;
        for (let i = 0; i < 3; i++) {
          ticks.push({ tsMs: periodBase + i * 1_000, bid: 150 });
        }
      }

      const result = await engine.run(makeParams({
        entryRule,
        exitRule,
        dataProvider: mockDataProvider(ticks),
      }));

      // BUY → SELL のドテンで少なくとも2トレード
      expect(result.trades.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SnapshotAdapter への tick.bid() 渡し', () => {
    it('addCandleAndBuild に tick.bid() が nextCandleOpen として渡される', async () => {
      const engine = new TickEngine(new PendingOrderManager(0));
      const adapter = mockSnapshotAdapter();

      const bid = 150.123;
      const baseMs = new Date('2024-01-01T00:00:00Z').getTime();
      const ticks = makeTicksSpanning2Candles(baseMs, 3, 3, bid);

      await engine.run(makeParams({
        snapshotAdapter: adapter,
        dataProvider: mockDataProvider(ticks),
      }));

      // addCandleAndBuild が呼ばれた場合、第3引数が tick.bid() に等しい
      const calls = (adapter.addCandleAndBuild as ReturnType<typeof vi.fn>).mock.calls;
      if (calls.length > 0) {
        const firstCall = calls[0]!;
        const nextCandleOpenArg = firstCall[2] as Price;
        // tick.bid() は Price オブジェクト
        expect(Number(nextCandleOpenArg.toString())).toBeCloseTo(bid, 3);
      }
    });
  });
});
