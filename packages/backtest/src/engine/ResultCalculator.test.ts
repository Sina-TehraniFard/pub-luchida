import { describe, it, expect } from 'vitest';
import { calculate, type ResultInput } from './ResultCalculator.js';
import type { TradeRecord } from '../result/TradeRecord.js';
import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';

function makeTrade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: 'trade-1',
    runId: 'run-1',
    tradeSeq: 0,
    side: 'BUY',
    entryTime: new Date('2024-01-15T10:00:00Z'),
    exitTime: new Date('2024-01-15T11:00:00Z'),
    entryPrice: 150.0,
    exitPrice: 150.1,
    lot: 100,
    pnl: 10,       // pips 建て（pnlPips と同値）
    pnlPips: 10,
    pnlAmount: 0,
    capitalAtEntry: 100_000,
    mfe: 15,        // pips 建て（mfePips と同値）
    mae: 5,         // pips 建て（maePips と同値）
    mfePips: 15,
    mfeTime: new Date('2024-01-15T10:30:00Z'),
    maePips: 5,
    maeTime: new Date('2024-01-15T10:15:00Z'),
    atrAtEntry: null,
    holdingPeriodMs: 3_600_000,
    exitType: 'TAKE_PROFIT',
    entryHourUtc: 10,
    entryDayOfWeek: 1,
    slippagePips: 0,
    equityAfter: 100_000,
    ...overrides,
  };
}

function makeInput(trades: TradeRecord[], overrides?: Partial<ResultInput>): ResultInput {
  return {
    runId: 'run-1',
    batchId: 'batch-1',
    pair: 'USD_JPY' as CurrencyPair,
    timeframe: 'FIFTEEN_MINUTE' as TimeFrame,
    strategy: 'SMA_CROSS',
    params: { shortPeriod: 20, longPeriod: 100 },
    dateFrom: new Date('2024-01-01T00:00:00Z'),
    dateTo: new Date('2024-07-01T00:00:00Z'),
    durationMs: 5000,
    trades,
    initialCapital: 100_000,
    engineMode: 'OHLC',
    executionConfig: { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 },
    codeVersion: 'test',
    tickCount: 0,
    barCount: 100,
    gapCount: 0,
    dataHash: '',
    sampleType: 'FULL',
    foldNumber: null,
    ...overrides,
  };
}

describe('ResultCalculator', () => {
  it('基本統計が正しく計算される', () => {
    const trades = [
      makeTrade({ pnl: 20, pnlPips: 20, side: 'BUY' }),
      makeTrade({ pnl: -10, pnlPips: -10, side: 'SELL' }),
      makeTrade({ pnl: 30, pnlPips: 30, side: 'BUY' }),
      makeTrade({ pnl: -5, pnlPips: -5, side: 'SELL' }),
    ];
    const result = calculate(makeInput(trades));
    expect(result.totalPnl).toBe(35);
    expect(result.tradeCount).toBe(4);
    expect(result.winCount).toBe(2);
    expect(result.lossCount).toBe(2);
    expect(result.winRate).toBe(0.5);
    expect(result.grossProfit).toBe(50);
    expect(result.grossLoss).toBe(15);
    expect(result.profitFactor).toBeCloseTo(50 / 15, 4);
    expect(result.avgPnl).toBe(8.75);
  });

  it('ドローダウンが正しく計算される', () => {
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10, exitTime: new Date('2024-01-02T00:00:00Z') }),
      makeTrade({ pnl: -20, pnlPips: -20, exitTime: new Date('2024-01-03T00:00:00Z') }),
      makeTrade({ pnl: -5, pnlPips: -5, exitTime: new Date('2024-01-04T00:00:00Z') }),
      makeTrade({ pnl: 30, pnlPips: 30, exitTime: new Date('2024-01-05T00:00:00Z') }),
    ];
    const result = calculate(makeInput(trades));
    // equity: 10, -10, -15, 15. peak=10 → DD = 10-(-15) = 25
    expect(result.maxDrawdown).toBe(25);
    expect(result.maxDrawdownPct).toBeCloseTo(25 / 10, 4);
  });

  it('シャープレシオとソルティノレシオが計算される', () => {
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10 }),
      makeTrade({ pnl: 20, pnlPips: 20 }),
      makeTrade({ pnl: -5, pnlPips: -5 }),
      makeTrade({ pnl: 15, pnlPips: 15 }),
    ];
    const result = calculate(makeInput(trades));
    expect(result.sharpeRatio).not.toBe(0);
    expect(result.sortinoRatio).not.toBe(0);
    // sharpe = avgPnl / stddev. mean = 10
    const mean = 10;
    const diffs = [0, 10, -15, 5];
    const stddev = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / 4);
    expect(result.sharpeRatio).toBeCloseTo(mean / stddev, 4);
  });

  it('annualizedSharpeRatio = perTradeSharpe × √(年間トレード数)', () => {
    // 期間 6 ヶ月, 4 trades → 年間 8 trades → 換算係数 √8
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10 }),
      makeTrade({ pnl: 20, pnlPips: 20 }),
      makeTrade({ pnl: -5, pnlPips: -5 }),
      makeTrade({ pnl: 15, pnlPips: 15 }),
    ];
    const result = calculate(makeInput(trades));
    const years = (new Date('2024-07-01T00:00:00Z').getTime() - new Date('2024-01-01T00:00:00Z').getTime())
      / (365.25 * 86_400_000);
    const factor = Math.sqrt(4 / years);
    expect(result.annualizedSharpeRatio).toBeCloseTo(result.sharpeRatio * factor, 4);
    expect(result.annualizedSortinoRatio).toBeCloseTo(result.sortinoRatio * factor, 4);
  });

  it('sortinoStandard は閾値 MAR=0 のダウンサイド偏差で計算される', () => {
    // pnl = [10, 20, -5, 15]。MAR=0 を下回るのは -5 のみ。
    // downsideDeviation = √( (-5)² / 4 ) = √(25/4) = 2.5
    // sortinoStandard = mean / downsideDeviation = 10 / 2.5 = 4
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10 }),
      makeTrade({ pnl: 20, pnlPips: 20 }),
      makeTrade({ pnl: -5, pnlPips: -5 }),
      makeTrade({ pnl: 15, pnlPips: 15 }),
    ];
    const result = calculate(makeInput(trades));
    expect(result.sortinoStandard).toBeCloseTo(10 / 2.5, 4);
    // mean 閾値の既存 sortinoRatio とは別物（温存されている）
    expect(result.sortinoRatio).not.toBe(result.sortinoStandard);
  });

  it('annualizedSortinoStandard = sortinoStandard × √(年間トレード数)', () => {
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10 }),
      makeTrade({ pnl: 20, pnlPips: 20 }),
      makeTrade({ pnl: -5, pnlPips: -5 }),
      makeTrade({ pnl: 15, pnlPips: 15 }),
    ];
    const result = calculate(makeInput(trades));
    const years = (new Date('2024-07-01T00:00:00Z').getTime() - new Date('2024-01-01T00:00:00Z').getTime())
      / (365.25 * 86_400_000);
    const factor = Math.sqrt(4 / years);
    expect(result.annualizedSortinoStandard).toBeCloseTo(result.sortinoStandard * factor, 4);
  });

  it('sqnCapped は n を 100 でキャップする（n≤100 では sqn と一致）', () => {
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10 }),
      makeTrade({ pnl: 20, pnlPips: 20 }),
      makeTrade({ pnl: -5, pnlPips: -5 }),
      makeTrade({ pnl: 15, pnlPips: 15 }),
    ];
    const result = calculate(makeInput(trades));
    // n=4 ≤ 100 なのでキャップなしの sqn と一致
    expect(result.sqnCapped).toBeCloseTo(result.sqn, 4);
    expect(result.sqnCapped).toBeCloseTo(result.sharpeRatio * Math.sqrt(4), 4);
  });

  it('#99 実測例: mean=4.62 / stddev=55.68 / trades=5516 / 20年 → 年率Sharpe≈1.38・sqnCapped≈0.83', () => {
    // 二値対称分布 {60.3, -51.06} を等数で並べると mean=4.62, stddev=55.68 を得る。
    // 期間を 20 年に取り、Issue 本文の実測例（業界標準値）を期待値リテラルで固定する。
    const HIGH = 60.3;
    const LOW = -51.06;
    const PAIRS = 2758; // 2758 × 2 = 5516 trades
    const trades: TradeRecord[] = [];
    for (let i = 0; i < PAIRS; i++) {
      trades.push(makeTrade({ pnl: HIGH, pnlPips: HIGH }));
      trades.push(makeTrade({ pnl: LOW, pnlPips: LOW }));
    }
    const result = calculate(
      makeInput(trades, {
        dateFrom: new Date('2004-01-01T00:00:00Z'),
        dateTo: new Date('2024-01-01T00:00:00Z'),
      }),
    );

    expect(result.tradeCount).toBe(5516);
    expect(result.avgPnl).toBeCloseTo(4.62, 2);
    expect(result.pnlStddev).toBeCloseTo(55.68, 2);
    // per-trade Sharpe = 4.62 / 55.68 ≈ 0.083（現実装の壊滅的に見える値）
    expect(result.sharpeRatio).toBeCloseTo(0.083, 3);
    // 年率換算 Sharpe ≈ 1.38（機関水準）
    expect(result.annualizedSharpeRatio).toBeCloseTo(1.38, 2);
    // sqnRaw（キャップなし）≈ 6.16
    expect(result.sqn).toBeCloseTo(6.16, 2);
    // sqnCapped（Van Tharp 原典 N≤100）≈ 0.83（Poor 域）
    expect(result.sqnCapped).toBeCloseTo(0.83, 2);
  });

  it('連続勝敗が正しく計算される', () => {
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10 }),
      makeTrade({ pnl: 20, pnlPips: 20 }),
      makeTrade({ pnl: 5, pnlPips: 5 }),
      makeTrade({ pnl: -10, pnlPips: -10 }),
      makeTrade({ pnl: -5, pnlPips: -5 }),
    ];
    const result = calculate(makeInput(trades));
    expect(result.maxConsecutiveWins).toBe(3);
    expect(result.maxConsecutiveLosses).toBe(2);
  });

  it('MFE/MAE 集計が正しく計算される', () => {
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10, mfe: 20, mfePips: 20, mae: 5, maePips: 5 }),
      makeTrade({ pnl: -5, pnlPips: -5, mfe: 10, mfePips: 10, mae: 8, maePips: 8 }),
    ];
    const result = calculate(makeInput(trades));
    expect(result.avgMfe).toBe(15);
    expect(result.avgMae).toBe(6.5);
    expect(result.mfeEfficiency).toBeCloseTo(2.5 / 15, 4);
  });

  it('0トレードケースで全て 0 になる', () => {
    const result = calculate(makeInput([]));
    expect(result.tradeCount).toBe(0);
    expect(result.totalPnl).toBe(0);
    expect(result.winRate).toBe(0);
    expect(result.sharpeRatio).toBe(0);
    expect(result.maxDrawdown).toBe(0);
    expect(result.trades).toHaveLength(0);
  });

  it('1トレードケースで stddev=0 → sharpeRatio=0', () => {
    const result = calculate(makeInput([makeTrade({ pnl: 10, pnlPips: 10 })]));
    expect(result.tradeCount).toBe(1);
    expect(result.pnlStddev).toBe(0);
    expect(result.sharpeRatio).toBe(0);
  });

  it('全勝ケースで lossCount=0 → payoffRatio=0。sortinoRatio はリターンのばらつきで正値', () => {
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10 }),
      makeTrade({ pnl: 20, pnlPips: 20 }),
      makeTrade({ pnl: 5, pnlPips: 5 }),
    ];
    const result = calculate(makeInput(trades));
    expect(result.lossCount).toBe(0);
    expect(result.payoffRatio).toBe(0);
    expect(result.sortinoRatio).toBeGreaterThan(0);
  });

  // #336: 損失0件の退化ケースで sortinoStandard=0 と
  // 真のブレークイーブン0 を hasDownsideRisk で判別できること
  it('全勝ケース（下方リスク無し）は sortinoStandard=0 だが hasDownsideRisk=false で判別できる', () => {
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10 }),
      makeTrade({ pnl: 20, pnlPips: 20 }),
      makeTrade({ pnl: 5, pnlPips: 5 }),
    ];
    const result = calculate(makeInput(trades));
    // 下方リスクが無いと割れず番兵値 0 を返す（最良ケースが 0 に潰れる）
    expect(result.sortinoStandard).toBe(0);
    // フラグで「下方リスク無しの番兵値 0」だと判別できる
    expect(result.hasDownsideRisk).toBe(false);
  });

  it('損失を含む通常ケースは hasDownsideRisk=true（番兵値ではない実値の sortinoStandard）', () => {
    const trades = [
      makeTrade({ pnl: 30, pnlPips: 30 }),
      makeTrade({ pnl: -10, pnlPips: -10 }),
      makeTrade({ pnl: 20, pnlPips: 20 }),
    ];
    const result = calculate(makeInput(trades));
    expect(result.hasDownsideRisk).toBe(true);
    expect(result.sortinoStandard).toBeGreaterThan(0);
  });

  // #336: 真のブレークイーブン（損失あり・平均0）の 0 は番兵値ではない実値の0。
  // hasDownsideRisk=true で、損失0件の番兵値0（hasDownsideRisk=false）と区別できる
  it('損失あり・平均0の真のブレークイーブンは sortinoStandard=0 だが hasDownsideRisk=true', () => {
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10 }),
      makeTrade({ pnl: -10, pnlPips: -10 }),
    ];
    const result = calculate(makeInput(trades));
    expect(result.avgPnl).toBe(0);
    // 分子 mean=0 のため sortinoStandard=0。ただし下方リスクは実在する
    expect(result.sortinoStandard).toBe(0);
    expect(result.hasDownsideRisk).toBe(true);
  });

  // #336: トレード0件は下方リスクの母数自体が無く hasDownsideRisk=false になる。
  // 「最良ケース（下方リスク無し）」の判定規則が tradeCount > 0 を要求する根拠を固定する
  it('トレード0件は hasDownsideRisk=false（最良ケースの判定には tradeCount > 0 が必須）', () => {
    const result = calculate(makeInput([]));
    expect(result.tradeCount).toBe(0);
    expect(result.sortinoStandard).toBe(0);
    // 0件でも false になるため、このフラグ単独では最良ケースと判定できない
    expect(result.hasDownsideRisk).toBe(false);
  });

  // #336: pnl=0 のトレードは lossCount に数えるが、下方リスクは
  // 「MAR=0 を下回る（pnl < 0）」定義（Sortino & Price 1994）のため含めない。
  // 「lossCount > 0 なのに hasDownsideRisk=false」があり得る意味のずれを固定する
  it('pnl=0 のトレードは lossCount に数えるが hasDownsideRisk には含めない', () => {
    const trades = [
      makeTrade({ pnl: 10, pnlPips: 10 }),
      makeTrade({ pnl: 0, pnlPips: 0 }),
    ];
    const result = calculate(makeInput(trades));
    // calcBasicStats は pnl=0 を loss に分類する
    expect(result.lossCount).toBe(1);
    // MAR=0 を「下回る」トレードは無いため下方リスクは無し（番兵値 0）
    expect(result.hasDownsideRisk).toBe(false);
    expect(result.sortinoStandard).toBe(0);
  });

  it('全敗ケースで winCount=0 → profitFactor=0', () => {
    const trades = [
      makeTrade({ pnl: -10, pnlPips: -10 }),
      makeTrade({ pnl: -20, pnlPips: -20 }),
      makeTrade({ pnl: -5, pnlPips: -5 }),
    ];
    const result = calculate(makeInput(trades));
    expect(result.winCount).toBe(0);
    expect(result.profitFactor).toBe(0);
    expect(result.grossProfit).toBe(0);
    // 全敗は下方リスクが実在し、sortinoStandard は番兵値ではなく負の実値
    expect(result.hasDownsideRisk).toBe(true);
    expect(result.sortinoStandard).toBeLessThan(0);
  });
});
