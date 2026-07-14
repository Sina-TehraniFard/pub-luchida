import type { BacktestResult } from './BacktestResult.js';

/**
 * BT 実行結果の永続化インターフェース。
 *
 * 保存先の実装を差し替えるだけで永続化方式を変更できる。
 * 読み出し（検索・集計）は別インターフェースとして必要時に追加する。
 */
export interface ResultStore {
  /**
   * 1回分の BT 結果を保存する。
   *
   * 同じ id で複数回呼ばれた場合の挙動は実装側で定義する。
   */
  save(result: BacktestResult): Promise<void>;
}
