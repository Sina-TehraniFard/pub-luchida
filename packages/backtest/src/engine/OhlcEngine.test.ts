import { describe, it, expect, vi } from 'vitest';

import { Price } from '@luchida/backend/domain/market/Price.js';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import { Tick } from '@luchida/backend/domain/market/tick/Tick.js';
import { TickTimestamp } from '@luchida/backend/domain/market/tick/TickTimestamp.js';
import { ConfirmedCandle } from '@luchida/backend/domain/market/candle/ConfirmedCandle.js';
import { CandleOpenTime } from '@luchida/backend/domain/market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '@luchida/backend/domain/market/candle/CandleCloseTime.js';
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
import type { EntryRule } from '@luchida/backend/domain/rule/EntryRule.js';
import type { ExitRule } from '@luchida/backend/domain/rule/ExitRule.js';
import type { Position } from '@luchida/backend/domain/position/Position.js';

import { OhlcEngine } from './OhlcEngine.js';
import { IdealExecutionSimulator } from '../simulator/IdealExecutionSimulator.js';
import type { DataProvider } from '../data-provider/DataProvider.js';
import type { SnapshotAdapter } from '../snapshot-adapter/SnapshotAdapter.js';
import type { EngineRunParams } from './Engine.js';

const pair = CurrencyPair('USD_JPY');
const tf = TimeFrame.FIFTEEN_MINUTE;

function makeCandle(index: number, closePrice: number): ConfirmedCandle {
  const baseTime = new Date('2024-01-01T00:00:00Z');
  const openMs = baseTime.getTime() + index * 900_000;
  return ConfirmedCandle.of({
    open: Price.of(closePrice.toFixed(3)),
    high: Price.of((closePrice + 0.05).toFixed(3)),
    low: Price.of((closePrice - 0.05).toFixed(3)),
    close: Price.of(closePrice.toFixed(3)),
    openTime: CandleOpenTime.of(new Date(openMs)),
    closeTime: CandleCloseTime.of(new Date(openMs + 900_000)),
    timeFrame: tf,
  });
}

function makeCandles(count: number, basePrice: number): ConfirmedCandle[] {
  return Array.from({ length: count }, (_, i) => makeCandle(i, basePrice + i * 0.01));
}

function makeDummySnapshot(): MarketSnapshot {
  const tick = Tick.of(Price.of('150.020'), Price.of('150.010'), TickTimestamp.of(new Date('2024-01-01T00:00:00Z')));
  return { tick, pair, capturedAt: { toDate: () => new Date() } } as unknown as MarketSnapshot;
}

function mockDataProvider(candles: ConfirmedCandle[]): DataProvider {
  return {
    fetchCandles: vi.fn().mockResolvedValue(candles),
    fetchTicks: vi.fn(),
  };
}

function mockSnapshotAdapter(): SnapshotAdapter {
  return {
    warmUp: vi.fn(),
    addCandleAndBuild: vi.fn().mockReturnValue(makeDummySnapshot()),
  };
}

/** 常に BUY エントリーする Rule */
function alwaysBuyEntryRule(): EntryRule {
  return {
    shouldEntry: () =>
      EntryCommand.of({
        pair,
        buySell: 'BUY',
        lot: Lot.of(1000),
        reason: EntryReason.of('テスト'),
        convictionScore: ConvictionScore.of('0.7'),
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: EntrySnapshot.of({ convictionScore: '0.7', entryHour: 10, entryDayOfWeek: 1 }),
        requiredMargin: Money.jpy('0'),
      }),
  };
}

/** 常に DoNothing を返す Rule */
function neverEntryRule(): EntryRule {
  return { shouldEntry: () => DoNothing.instance };
}

function neverExitRule(): ExitRule {
  return { shouldExit: () => DoNothing.instance };
}

function makeParams(overrides: Partial<EngineRunParams> = {}): EngineRunParams {
  return {
    config: { pair, timeframe: tf, dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') }, warmupCount: 3 },
    entryRule: neverEntryRule(),
    exitRule: neverExitRule(),
    dataProvider: mockDataProvider(makeCandles(10, 150)),
    snapshotAdapter: mockSnapshotAdapter(),
    executionSimulator: new IdealExecutionSimulator(),
    runId: 'test-run',
    batchId: 'test-batch',
    strategy: 'SMA_CROSS',
    params: { shortPeriod: 20, longPeriod: 100 },
    equityState: null,
    marketState: null,
    initialCapital: 100_000,
    engineMode: 'OHLC',
    executionConfig: { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 },
    codeVersion: 'test',
    ...overrides,
  };
}

describe('OhlcEngine', () => {
  const engine = new OhlcEngine();

  it('warmup 期間中は Rule が呼ばれない', async () => {
    const entryRule = { shouldEntry: vi.fn().mockReturnValue(DoNothing.instance) };
    const exitRule = { shouldExit: vi.fn().mockReturnValue(DoNothing.instance) };
    const candles = makeCandles(10, 150);

    await engine.run(makeParams({ entryRule, exitRule, dataProvider: mockDataProvider(candles), config: { pair, timeframe: tf, dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') }, warmupCount: 5 } }));

    // warmup=5, candles=10, 処理対象は index 5..8 (length-1=9 は除外) → 4回
    expect(entryRule.shouldEntry).toHaveBeenCalledTimes(4);
  });

  it('決済がエントリーより先に評価される（ドテン対応）', async () => {
    const candles = makeCandles(8, 150); // warmup=3, ループ: index 3,4,5,6
    let callCount = 0;

    // 足3で BUY エントリー → 足4で決済 + 同じ足で SELL エントリー
    const entryRule: EntryRule = {
      shouldEntry: () => {
        callCount++;
        if (callCount === 1) return alwaysBuyEntryRule().shouldEntry(makeDummySnapshot()); // BUY
        if (callCount === 2) {
          // SELL（ドテン）
          return EntryCommand.of({
            pair, buySell: 'SELL', lot: Lot.of(1000),
            reason: EntryReason.of('ドテン SELL'),
            convictionScore: ConvictionScore.of('0.7'),
            strategyName: StrategyName.SMA_CROSS,
            entrySnapshot: EntrySnapshot.of({ convictionScore: '0.7', entryHour: 10, entryDayOfWeek: 1 }),
            requiredMargin: Money.jpy('0'),
          });
        }
        return DoNothing.instance;
      },
    };
    const exitRule: ExitRule = {
      shouldExit: (_snapshot: MarketSnapshot, position: Position) => {
        // 2回目のループ（足4）でポジションがあれば決済
        if (callCount >= 1) {
          return ExitCommand.of({
            positionId: position.id,
            type: ExitType.TAKE_PROFIT,
            reason: ExitReason.of('ドテン決済'),
          });
        }
        return DoNothing.instance;
      },
    };

    const result = await engine.run(makeParams({
      entryRule, exitRule,
      dataProvider: mockDataProvider(candles),
      config: { pair, timeframe: tf, dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') }, warmupCount: 3 },
    }));

    // 決済と新エントリーが同じ足で起きる → 2トレード以上
    expect(result.trades.length).toBeGreaterThanOrEqual(2);
    expect(result.trades[0]!.side).toBe('BUY');
    expect(result.trades[1]!.side).toBe('SELL');
  });

  it('時間整合性: addCandleAndBuild に currentCandle が渡され、約定は nextCandle.open で行われる', async () => {
    const candles = makeCandles(6, 150);
    const adapter = mockSnapshotAdapter();

    const result = await engine.run(makeParams({
      entryRule: alwaysBuyEntryRule(),
      exitRule: neverExitRule(),
      dataProvider: mockDataProvider(candles),
      snapshotAdapter: adapter,
      config: { pair, timeframe: tf, dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') }, warmupCount: 3 },
    }));

    // addCandleAndBuild の第1引数は candles[3]（warmup=3 の次）
    const firstCall = (adapter.addCandleAndBuild as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(firstCall[0]).toBe(candles[3]);

    // エントリー約定価格は candles[4].open（足 N+1 の open）
    expect(result.trades.length).toBe(1);
    expect(result.trades[0]!.entryPrice).toBeCloseTo(Number(candles[4]!.open.toString()), 4);
  });

  it('最終足でのシグナルは処理されない（ループは length-1 まで）', async () => {
    const entryRule = { shouldEntry: vi.fn().mockReturnValue(DoNothing.instance) };
    const candles = makeCandles(6, 150); // warmup=3, ループ: index 3,4 (5はスキップ)

    await engine.run(makeParams({
      entryRule,
      dataProvider: mockDataProvider(candles),
      config: { pair, timeframe: tf, dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') }, warmupCount: 3 },
    }));

    // 6本 - warmup3 - 最終足1 = 2回
    expect(entryRule.shouldEntry).toHaveBeenCalledTimes(2);
  });

  it('未決済ポジションが最終足で FORCE_CLOSE される', async () => {
    const result = await engine.run(makeParams({
      entryRule: alwaysBuyEntryRule(),
      exitRule: neverExitRule(),
    }));

    // 全トレードが FORCE_CLOSE で決済されているはず
    expect(result.trades.length).toBeGreaterThan(0);
    for (const trade of result.trades) {
      expect(trade.exitType).toBe('FORCE_CLOSE');
    }
  });

  it('0トレード（シグナルなし）で正常に BacktestResult が返る', async () => {
    const result = await engine.run(makeParams({ entryRule: neverEntryRule() }));
    expect(result.tradeCount).toBe(0);
    expect(result.trades).toHaveLength(0);
    expect(result.totalPnl).toBe(0);
  });

  it('MFE/MAE が high/low で更新される', async () => {
    // 高い high と低い low を持つ足を用意
    const candles: ConfirmedCandle[] = [];
    const baseTime = new Date('2024-01-01T00:00:00Z');
    for (let i = 0; i < 8; i++) {
      const openMs = baseTime.getTime() + i * 900_000;
      candles.push(ConfirmedCandle.of({
        open: Price.of('150.000'),
        high: Price.of(i === 4 ? '150.500' : '150.050'),  // 4本目で大きな high
        low: Price.of(i === 5 ? '149.500' : '149.950'),   // 5本目で大きな low
        close: Price.of('150.000'),
        openTime: CandleOpenTime.of(new Date(openMs)),
        closeTime: CandleCloseTime.of(new Date(openMs + 900_000)),
        timeFrame: tf,
      }));
    }

    const result = await engine.run(makeParams({
      entryRule: alwaysBuyEntryRule(),
      exitRule: neverExitRule(),
      dataProvider: mockDataProvider(candles),
      config: { pair, timeframe: tf, dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') }, warmupCount: 3 },
    }));

    // MFE/MAE が 0 でないこと（high/low で更新されているはず）
    expect(result.trades.length).toBe(1);
    expect(result.trades[0]!.mfePips).toBeGreaterThan(0);
    expect(result.trades[0]!.maePips).toBeGreaterThan(0);
  });

  it('1戦略1ポジション制約: 既存ポジションがあれば EntryCommand を無視', async () => {
    // 決済しないので1ポジションのまま
    const result = await engine.run(makeParams({
      entryRule: alwaysBuyEntryRule(),
      exitRule: neverExitRule(),
    }));

    // FORCE_CLOSE で1つだけ出る
    expect(result.trades).toHaveLength(1);
  });

  it('DataProvider が warmupCount より少ない足を返すとエラー', async () => {
    const candles = makeCandles(3, 150);
    await expect(
      engine.run(makeParams({
        dataProvider: mockDataProvider(candles),
        config: { pair, timeframe: tf, dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') }, warmupCount: 5 },
      })),
    ).rejects.toThrow('warmup');
  });

  it('DataProvider が 0 本を返すとエラー', async () => {
    await expect(
      engine.run(makeParams({ dataProvider: mockDataProvider([]) })),
    ).rejects.toThrow('0 本');
  });
});
