import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import type { StrategyType } from '../parameter/StrategyType.js';
import type { EngineMode } from '../engine/EngineConfig.js';
import type { ExecutionConfig } from '../config/ExecutionConfig.js';
import type { TradeRecord } from './TradeRecord.js';

/**
 * BT 実行 1 回分の集計結果。
 *
 * 永続化層のスキーマ（bt_runs）と 1:1 対応する構造。
 * 戦略固有パラメータは `params` に自由形式で格納する。
 */
export interface BacktestResult {
  // ===================== 識別・実行条件 =====================
  readonly id: string;
  readonly batchId: string;
  readonly pair: CurrencyPair;
  readonly timeframe: TimeFrame;
  readonly strategy: StrategyType;
  readonly params: Record<string, unknown>;
  readonly dateFrom: Date;
  readonly dateTo: Date;
  readonly initialCapital: number;
  readonly engineMode: EngineMode;
  readonly executionConfig: ExecutionConfig;

  // ===================== 再現性・監査 =====================
  readonly codeVersion: string;
  readonly tickCount: number;
  readonly barCount: number;
  readonly gapCount: number;
  readonly dataHash: string;
  readonly sampleType: SampleType;
  readonly foldNumber: number | null;

  // ===================== 収益性指標 =====================
  readonly totalPnl: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly avgPnl: number;
  readonly avgWin: number;
  readonly avgLoss: number;
  readonly medianPnl: number;
  readonly largestWin: number;
  readonly largestLoss: number;
  readonly payoffRatio: number;
  readonly profitFactor: number;
  readonly expectancyPips: number;
  readonly pnlPerDay: number;

  // ===================== 勝率・トレード数 =====================
  readonly tradeCount: number;
  readonly winCount: number;
  readonly lossCount: number;
  readonly winRate: number;
  readonly longCount: number;
  readonly shortCount: number;
  readonly longWinRate: number;
  readonly shortWinRate: number;
  readonly tradesPerMonth: number;

  // ===================== リスク・ドローダウン =====================
  readonly maxDrawdown: number;
  readonly maxDrawdownPct: number;
  readonly maxDrawdownDurationMs: number;
  readonly avgDrawdown: number;
  readonly calmarRatio: number;
  readonly recoveryFactor: number;
  readonly ulcerIndex: number;

  // ===================== 安定性 =====================
  readonly pnlStddev: number;
  /** per-trade Sharpe = avgPnl / pnlStddev（無次元化なし） */
  readonly sharpeRatio: number;
  /** 年率換算 Sharpe = sharpeRatio × √(年間トレード数)。機関標準と比較可能 */
  readonly annualizedSharpeRatio: number;
  /** per-trade Sortino = avgPnl / downsideStddev（閾値=mean。非標準・誤読防止のため温存） */
  readonly sortinoRatio: number;
  /** 年率換算 Sortino = sortinoRatio × √(年間トレード数) */
  readonly annualizedSortinoRatio: number;
  /**
   * 業界標準 Sortino = avgPnl / downsideDeviation。
   * 閾値は MAR（Minimum Acceptable Return = 0）。Sortino & Price (1994) の原典定義。
   * 既存の sortinoRatio が閾値に mean を使う非標準実装のため、本カラムを新規追加した。
   */
  readonly sortinoStandard: number;
  /** 年率換算した業界標準 Sortino = sortinoStandard × √(年間トレード数) */
  readonly annualizedSortinoStandard: number;
  /** SQN（per-trade × √n。n キャップなし。誤読防止のため温存） */
  readonly sqn: number;
  /**
   * Van Tharp 原典 SQN = (mean/stddev) × √min(n, 100)。
   * n を 100 でキャップし、高頻度戦略で値が際限なく膨張することを防ぐ。
   * 既存の sqn が n キャップなしのため、本カラムを新規追加した。
   */
  readonly sqnCapped: number;
  /**
   * 下方リスク（MAR=0 を下回る損失トレード）が存在したか。
   * tradeCount > 0 かつ false かつ sortinoStandard=0 のときは「割れないための
   * 番兵値 0」であり、「下方リスク無し＝最良ケース（概念上 +∞）」を意味する。
   * 真にブレークイーブンの 0 と区別するための判別子。ランキング・スクリーニングでは
   * このフラグで退化レコードを除外・別扱いすること（0 を素直に不良成績と読まない）。
   * tradeCount=0 は下方リスクの母数自体が無く false になるため、
   * tradeCount > 0 を確認せずに最良ケースと解釈してはならない。
   *
   * 注意: pnl=0 のトレードは lossCount には数えるが、下方リスクは
   * 「MAR=0 を下回る（pnl < 0）」定義（Sortino & Price 1994）のため含めない。
   * したがって lossCount > 0 でも hasDownsideRisk=false があり得る。
   */
  readonly hasDownsideRisk: boolean;
  readonly maxConsecutiveWins: number;
  readonly maxConsecutiveLosses: number;

  // ===================== MFE/MAE 集計 =====================
  readonly avgMfe: number;
  readonly avgMae: number;
  readonly mfeEfficiency: number;

  // ===================== 時間効率 =====================
  readonly avgHoldingPeriodMs: number;

  // ===================== メタ =====================
  readonly status: BacktestStatus;
  readonly ranAt: Date;
  readonly durationMs: number;

  // ===================== 明細 =====================
  readonly trades: ReadonlyArray<TradeRecord>;
}

export const BacktestStatus = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type BacktestStatus = (typeof BacktestStatus)[keyof typeof BacktestStatus];

export const SampleType = {
  FULL: 'FULL',
  IN_SAMPLE: 'IN_SAMPLE',
  OUT_OF_SAMPLE: 'OUT_OF_SAMPLE',
  WALK_FORWARD: 'WALK_FORWARD',
} as const;
export type SampleType = (typeof SampleType)[keyof typeof SampleType];
