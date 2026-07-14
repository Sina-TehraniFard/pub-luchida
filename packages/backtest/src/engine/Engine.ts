import type { EntryRule } from '@luchida/backend/domain/rule/EntryRule.js';
import type { ExitRule } from '@luchida/backend/domain/rule/ExitRule.js';
import type { EngineConfig } from './EngineConfig.js';
import type { DataProvider } from '../data-provider/DataProvider.js';
import type { SnapshotAdapter } from '../snapshot-adapter/SnapshotAdapter.js';
import type { ExecutionSimulator } from '../simulator/ExecutionSimulator.js';
import type { BacktestResult, SampleType } from '../result/BacktestResult.js';
import type { EngineMode } from './EngineConfig.js';
import type { ExecutionConfig } from '../config/ExecutionConfig.js';
import type { StrategyType } from '../parameter/StrategyType.js';
import type { TimeFrameIndicatorSpec } from '@luchida/backend/domain/market/indicator/TimeFrameIndicatorSpec.js';

/**
 * 時系列ループを回し、売買判定と約定再現の結果を集計する主体。
 *
 * データ取得・スナップショット組立・売買判定・約定再現はすべて
 * 引数の interface 越しに委譲する。Engine 自身はモード分岐を持たない。
 */
export interface Engine {
  run(params: EngineRunParams): Promise<BacktestResult>;
}

/** Engine.run() に必要な全依存とメタデータ。 */
export interface EngineRunParams {
  readonly config: EngineConfig;
  readonly entryRule: EntryRule;
  readonly exitRule: ExitRule;
  readonly dataProvider: DataProvider;
  readonly snapshotAdapter: SnapshotAdapter;
  readonly executionSimulator: ExecutionSimulator;
  readonly runId: string;
  readonly batchId: string;
  readonly strategy: StrategyType;
  readonly params: Record<string, unknown>;
  /**
   * 複利計算用の共有 equity state。
   * Runner が生成し、Rule の getLot クロージャと Engine の両方から参照する。
   * Engine はトレード決済後に equity を更新する。null なら複利なし（固定 Lot）。
   */
  readonly equityState: EquityState | null;
  /**
   * 現在レート共有 state。Runner の getLot が LotDecisionInput 組み立て時に参照する。
   * Engine は各足の confirm 時点で currentRate を更新する。null なら未使用（Lot 計算側でレートを要求しない policy を使う前提）。
   */
  readonly marketState: MarketState | null;
  readonly initialCapital: number;
  readonly engineMode: EngineMode;
  readonly executionConfig: ExecutionConfig;
  readonly codeVersion: string;
  /** IS/OOS/WF 等のサンプル種別。省略時は FULL。 */
  readonly sampleType?: SampleType;
  /** WALK_FORWARD のとき fold 番号、他は null。 */
  readonly foldNumber?: number | null;
  /**
   * 駆動足（config.timeframe）以外で計算する indicator spec 一覧。
   * 上位足トレンド整合フィルター等の multi-timeframe 用。空 or 未指定で従来通り単一 tf 動作。
   */
  readonly additionalIndicatorSpecs?: ReadonlyArray<TimeFrameIndicatorSpec>;
}

/**
 * 複利計算用の共有状態。Runner と Rule の getLot クロージャが参照する。
 * Engine がトレード決済後に equity を更新する。
 */
export interface EquityState {
  equity: number;  // 現在の資金（円）。mutable。
}

/**
 * 現在レートの共有状態。Runner の getLot が LotDecisionInput 組み立て時に参照する。
 * Engine が各足/tick で currentRate を更新する。
 *
 * currentRate が null の間は「まだ実レートが来ていない状態」。Lot 計算に
 * レートを必要とする policy を呼ぶとエラー。Engine は最初の足/tick で必ず
 * 実数値に差し替える。0 を初期値にすると「0 という有効値」に見えて Policy
 * 側が silent に壊れるため、明示的に null を採用。
 */
export interface MarketState {
  currentRate: number | null;  // 現在の base 通貨 1 単位あたりの quote 通貨価格。未取得時は null。
}
