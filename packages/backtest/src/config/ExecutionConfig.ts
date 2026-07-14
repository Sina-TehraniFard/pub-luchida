/**
 * BT 実行環境の設定。ParameterSet（戦略パラメータ）とは独立した型。
 *
 * - slippageStddevPips: スリッページの標準偏差（pips 単位）。0 = スリッページなし
 * - executionDelayMs: 約定遅延（ミリ秒）。0 = 即時約定
 * - randomSeed: 乱数シード。同一シードを ParameterSet 全体で共有することで
 *   「パラメータの良し悪し」と「乱数の運」を分離する
 */
export interface ExecutionConfig {
  readonly slippageStddevPips: number;
  readonly executionDelayMs: number;
  readonly randomSeed: number;
}
