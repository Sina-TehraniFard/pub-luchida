import type { BacktestResult, BacktestStatus, SampleType } from '../result/BacktestResult.js';
import type { TradeRecord } from '../result/TradeRecord.js';
import type { StrategyType } from '../parameter/StrategyType.js';
import type { EngineMode } from './EngineConfig.js';
import type { ExecutionConfig } from '../config/ExecutionConfig.js';
import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';

export interface ResultInput {
  readonly runId: string;
  readonly batchId: string;
  readonly pair: CurrencyPair;
  readonly timeframe: TimeFrame;
  readonly strategy: StrategyType;
  readonly params: Record<string, unknown>;
  readonly dateFrom: Date;
  readonly dateTo: Date;
  readonly trades: ReadonlyArray<TradeRecord>;
  readonly durationMs: number;

  // 実行環境メタ
  readonly initialCapital: number;
  readonly engineMode: EngineMode;
  readonly executionConfig: ExecutionConfig;
  readonly codeVersion: string;
  readonly tickCount: number;
  readonly barCount: number;
  readonly gapCount: number;
  readonly dataHash: string;
  readonly sampleType: SampleType;
  readonly foldNumber: number | null;
}

export function calculate(input: ResultInput): BacktestResult {
  const { trades } = input;
  if (trades.length === 0) return assembleZero(input);

  const basic = calcBasicStats(trades);
  const risk = calcRiskMetrics(trades, basic, input.dateFrom, input.dateTo);
  const stability = calcStability(trades, basic, input.dateFrom, input.dateTo);
  const mfeStats = calcMfeStats(trades);

  return assemble(input, basic, risk, stability, mfeStats);
}

// -- helpers --

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

// -- Phase 1: basic stats --

interface BasicStats {
  totalPnl: number;
  grossProfit: number;
  grossLoss: number;
  avgPnl: number;
  avgWin: number;
  avgLoss: number;
  medianPnl: number;
  largestWin: number;
  largestLoss: number;
  payoffRatio: number;
  profitFactor: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  longCount: number;
  shortCount: number;
  longWinRate: number;
  shortWinRate: number;
  avgHoldingPeriodMs: number;
}

function calcBasicStats(trades: ReadonlyArray<TradeRecord>): BasicStats {
  let grossProfit = 0;
  let grossLoss = 0;
  let totalPnl = 0;
  let winCount = 0;
  let lossCount = 0;
  let longCount = 0;
  let shortCount = 0;
  let longWinCount = 0;
  let shortWinCount = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let totalHoldingMs = 0;

  for (const t of trades) {
    totalPnl += t.pnl;
    totalHoldingMs += t.holdingPeriodMs;

    if (t.pnl > 0) {
      winCount++;
      grossProfit += t.pnl;
      if (t.pnl > largestWin) largestWin = t.pnl;
    } else {
      lossCount++;
      grossLoss += Math.abs(t.pnl);
      if (Math.abs(t.pnl) > largestLoss) largestLoss = Math.abs(t.pnl);
    }

    if (t.side === 'BUY') {
      longCount++;
      if (t.pnl > 0) longWinCount++;
    } else {
      shortCount++;
      if (t.pnl > 0) shortWinCount++;
    }
  }

  const n = trades.length;
  const avgWin = safeDivide(grossProfit, winCount);
  const avgLoss = safeDivide(grossLoss, lossCount);

  const sorted = [...trades].sort((a, b) => a.pnl - b.pnl);
  const mid = Math.floor(n / 2);
  const medianPnl = n % 2 === 1 ? sorted[mid]!.pnl : (sorted[mid - 1]!.pnl + sorted[mid]!.pnl) / 2;

  return {
    totalPnl,
    grossProfit,
    grossLoss,
    avgPnl: totalPnl / n,
    avgWin,
    avgLoss,
    medianPnl,
    largestWin,
    largestLoss,
    payoffRatio: safeDivide(avgWin, avgLoss),
    profitFactor: safeDivide(grossProfit, grossLoss),
    tradeCount: n,
    winCount,
    lossCount,
    winRate: winCount / n,
    longCount,
    shortCount,
    longWinRate: safeDivide(longWinCount, longCount),
    shortWinRate: safeDivide(shortWinCount, shortCount),
    avgHoldingPeriodMs: totalHoldingMs / n,
  };
}

// -- Phase 2: risk metrics --

interface RiskMetrics {
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxDrawdownDurationMs: number;
  avgDrawdown: number;
  calmarRatio: number;
  recoveryFactor: number;
  ulcerIndex: number;
  expectancyPips: number;
  pnlPerDay: number;
  tradesPerMonth: number;
}

function calcRiskMetrics(
  trades: ReadonlyArray<TradeRecord>,
  basic: BasicStats,
  dateFrom: Date,
  dateTo: Date,
): RiskMetrics {
  const btDaysRaw = (dateTo.getTime() - dateFrom.getTime()) / 86_400_000;
  const btDays = Math.max(btDaysRaw, 1);

  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  let maxDDPct = 0;
  let ddSumSq = 0;
  let ddCount = 0;
  let ddSum = 0;
  let maxDDDuration = 0;
  let lastPeakTime = trades[0]!.exitTime.getTime();
  let currentDDStart = lastPeakTime;
  let inDrawdown = false;

  for (const t of trades) {
    equity += t.pnl;
    if (equity > peak) {
      if (inDrawdown) {
        const duration = t.exitTime.getTime() - currentDDStart;
        if (duration > maxDDDuration) maxDDDuration = duration;
        inDrawdown = false;
      }
      peak = equity;
      lastPeakTime = t.exitTime.getTime();
    }
    const dd = peak - equity;
    if (dd > 0) {
      if (!inDrawdown) {
        currentDDStart = lastPeakTime;
        inDrawdown = true;
      }
      if (dd > maxDD) maxDD = dd;
      const ddPct = safeDivide(dd, peak);
      if (ddPct > maxDDPct) maxDDPct = ddPct;
      ddSumSq += ddPct * ddPct;
      ddCount++;
      ddSum += dd;
    }
  }
  if (inDrawdown) {
    const lastExit = trades[trades.length - 1]!.exitTime.getTime();
    const duration = lastExit - currentDDStart;
    if (duration > maxDDDuration) maxDDDuration = duration;
  }

  const avgDrawdown = safeDivide(ddSum, ddCount);
  const ulcerIndex = Math.sqrt(safeDivide(ddSumSq, trades.length));

  const annualReturn = btDaysRaw >= 90 ? (basic.totalPnl / btDays) * 365 : 0;
  const calmarRatio = safeDivide(annualReturn, maxDD);
  const recoveryFactor = safeDivide(basic.totalPnl, maxDD);
  const btMonths = btDays / 30;

  return {
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct,
    maxDrawdownDurationMs: maxDDDuration,
    avgDrawdown,
    calmarRatio,
    recoveryFactor,
    ulcerIndex,
    expectancyPips: safeDivide(basic.totalPnl, basic.tradeCount),
    pnlPerDay: basic.totalPnl / btDays,
    tradesPerMonth: safeDivide(basic.tradeCount, btMonths),
  };
}

// -- Phase 3: stability --

interface StabilityMetrics {
  pnlStddev: number;
  sharpeRatio: number;
  annualizedSharpeRatio: number;
  sortinoRatio: number;
  annualizedSortinoRatio: number;
  sortinoStandard: number;
  annualizedSortinoStandard: number;
  sqn: number;
  sqnCapped: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  /**
   * 下方リスク（MAR=0 を下回る損失トレード）が存在したか。
   * tradeCount > 0 かつ false かつ sortinoStandard=0 のときは「割れない番兵値の 0」
   * であり、「下方リスク無し＝最良ケース（本来は概念上 +∞）」を意味する。
   * 0 を素直に「不良成績」と読むと最良ケースを取り違えるため、
   * ランキング・スクリーニングではこのフラグで退化レコードを判別すること。
   * トレード0件も false になるため、tradeCount > 0 を確認せずに
   * 最良ケースと解釈してはならない。
   *
   * 注意: pnl=0 のトレードは lossCount には数えるが、下方リスクは
   * 「MAR=0 を下回る（pnl < 0）」定義（Sortino & Price 1994）のため含めない。
   * したがって lossCount > 0 でも hasDownsideRisk=false があり得る。
   */
  hasDownsideRisk: boolean;
}

const MS_PER_YEAR = 365.25 * 86_400_000;

/** Van Tharp 原典 SQN の n キャップ上限 */
const SQN_TRADE_CAP = 100;

function calcStability(
  trades: ReadonlyArray<TradeRecord>,
  basic: BasicStats,
  dateFrom: Date,
  dateTo: Date,
): StabilityMetrics {
  const n = trades.length;
  const mean = basic.avgPnl;

  let sumSq = 0;
  let downsideSumSq = 0;
  // 業界標準 Sortino: 閾値 MAR=0 を下回る乖離だけで計算するダウンサイド偏差
  let downsideSumSqMar = 0;
  for (const t of trades) {
    const diff = t.pnl - mean;
    sumSq += diff * diff;
    if (diff < 0) {
      downsideSumSq += diff * diff;
    }
    if (t.pnl < 0) {
      downsideSumSqMar += t.pnl * t.pnl;
    }
  }

  const pnlStddev = Math.sqrt(sumSq / n);
  const downsideStddev = Math.sqrt(downsideSumSq / n);
  const downsideDeviationMar = Math.sqrt(downsideSumSqMar / n);

  let maxWins = 0;
  let maxLosses = 0;
  let currentWins = 0;
  let currentLosses = 0;
  for (const t of trades) {
    if (t.pnl > 0) {
      currentWins++;
      currentLosses = 0;
      if (currentWins > maxWins) maxWins = currentWins;
    } else {
      currentLosses++;
      currentWins = 0;
      if (currentLosses > maxLosses) maxLosses = currentLosses;
    }
  }

  const perTradeSharpe = safeDivide(mean, pnlStddev);
  const perTradeSortino = safeDivide(mean, downsideStddev);
  const sortinoStandard = safeDivide(mean, downsideDeviationMar);
  const years = Math.max((dateTo.getTime() - dateFrom.getTime()) / MS_PER_YEAR, 1e-9);
  const tradesPerYear = n / years;
  const annualizationFactor = Math.sqrt(tradesPerYear);

  return {
    pnlStddev,
    sharpeRatio: perTradeSharpe,
    annualizedSharpeRatio: perTradeSharpe * annualizationFactor,
    sortinoRatio: perTradeSortino,
    annualizedSortinoRatio: perTradeSortino * annualizationFactor,
    sortinoStandard,
    annualizedSortinoStandard: sortinoStandard * annualizationFactor,
    sqn: perTradeSharpe * Math.sqrt(n),
    sqnCapped: perTradeSharpe * Math.sqrt(Math.min(n, SQN_TRADE_CAP)),
    maxConsecutiveWins: maxWins,
    maxConsecutiveLosses: maxLosses,
    // 損失トレードが1件も無いと downsideDeviationMar=0 → safeDivide が
    // sortinoStandard=0 を返す（割れないための番兵値）。この退化と
    // 「真にブレークイーブンで 0」を後段で判別できるようフラグで残す。
    hasDownsideRisk: downsideDeviationMar > 0,
  };
}

// -- Phase 4: MFE/MAE --

interface MfeStats {
  avgMfe: number;
  avgMae: number;
  mfeEfficiency: number;
}

function calcMfeStats(trades: ReadonlyArray<TradeRecord>): MfeStats {
  let totalMfe = 0;
  let totalMae = 0;
  for (const t of trades) {
    totalMfe += t.mfePips;
    totalMae += t.maePips;
  }
  const n = trades.length;
  const avgMfe = totalMfe / n;
  const avgMae = totalMae / n;
  const avgPnlPips = trades.reduce((s, t) => s + t.pnlPips, 0) / n;
  return {
    avgMfe,
    avgMae,
    mfeEfficiency: safeDivide(avgPnlPips, avgMfe),
  };
}

// -- assemblers --

function assemble(
  input: ResultInput,
  basic: BasicStats,
  risk: RiskMetrics,
  stability: StabilityMetrics,
  mfe: MfeStats,
): BacktestResult {
  return {
    id: input.runId,
    batchId: input.batchId,
    pair: input.pair,
    timeframe: input.timeframe,
    strategy: input.strategy,
    params: input.params,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    initialCapital: input.initialCapital,
    engineMode: input.engineMode,
    executionConfig: input.executionConfig,
    codeVersion: input.codeVersion,
    tickCount: input.tickCount,
    barCount: input.barCount,
    gapCount: input.gapCount,
    dataHash: input.dataHash,
    sampleType: input.sampleType,
    foldNumber: input.foldNumber,
    ...basic,
    ...risk,
    ...stability,
    ...mfe,
    status: 'SUCCESS' as BacktestStatus,
    ranAt: new Date(),
    durationMs: input.durationMs,
    trades: Array.from(input.trades),
  };
}

function assembleZero(input: ResultInput): BacktestResult {
  return {
    id: input.runId,
    batchId: input.batchId,
    pair: input.pair,
    timeframe: input.timeframe,
    strategy: input.strategy,
    params: input.params,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    initialCapital: input.initialCapital,
    engineMode: input.engineMode,
    executionConfig: input.executionConfig,
    codeVersion: input.codeVersion,
    tickCount: input.tickCount,
    barCount: input.barCount,
    gapCount: input.gapCount,
    dataHash: input.dataHash,
    sampleType: input.sampleType,
    foldNumber: input.foldNumber,
    totalPnl: 0, grossProfit: 0, grossLoss: 0,
    avgPnl: 0, avgWin: 0, avgLoss: 0, medianPnl: 0,
    largestWin: 0, largestLoss: 0, payoffRatio: 0, profitFactor: 0,
    expectancyPips: 0, pnlPerDay: 0,
    tradeCount: 0, winCount: 0, lossCount: 0, winRate: 0,
    longCount: 0, shortCount: 0, longWinRate: 0, shortWinRate: 0,
    tradesPerMonth: 0,
    maxDrawdown: 0, maxDrawdownPct: 0, maxDrawdownDurationMs: 0,
    avgDrawdown: 0, calmarRatio: 0, recoveryFactor: 0, ulcerIndex: 0,
    pnlStddev: 0, sharpeRatio: 0, annualizedSharpeRatio: 0,
    sortinoRatio: 0, annualizedSortinoRatio: 0,
    sortinoStandard: 0, annualizedSortinoStandard: 0,
    sqn: 0, sqnCapped: 0,
    // トレード0件は下方リスクの母数自体が無いので false。
    // 「最良ケース（下方リスク無し）」の判定規則が tradeCount > 0 を
    // 要求するのはこのため（0件 run を最良ケースと取り違えない）。
    hasDownsideRisk: false,
    maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
    avgMfe: 0, avgMae: 0, mfeEfficiency: 0,
    avgHoldingPeriodMs: 0,
    status: 'SUCCESS' as BacktestStatus,
    ranAt: new Date(),
    durationMs: input.durationMs,
    trades: [],
  };
}
