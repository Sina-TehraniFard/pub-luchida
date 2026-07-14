import type { PositionId } from '../position/PositionId.js';
import type { StrategyName } from '../rule/StrategyName.js';

/**
 * skipped エントリ。Position 単位で記録する。
 * - `reason: 'rule_missing'`: Registry に当該戦略の ExitRule が登録されていない。
 *   起動時 fail-fast / Registry 再構成までは次 tick 以降も継続しうる（=「永続スキップ」とみなして監視する）
 * - `reason: 'extremes_unavailable'`: Updater.update がまだ走っていない一時状態。
 *   次 tick で自然解消する想定
 * - `reason: 'compensation_pending'`: broker 決済済み・DB 反映待ち（#186 補償キューのシールド）。
 *   DB が OPEN のままでも再決済してはいけない。補償成功 or 定期 sync で解消する
 * - `reason: 'failure_cooldown'`: 決済失敗直後のクールダウン中（#186 停止回路）。
 *   クールダウン tick 経過で自動再試行される
 */
export interface ExitDispatchSkipEntry {
  readonly positionId: PositionId;
  readonly strategy: StrategyName;
  readonly reason:
    | 'rule_missing'
    | 'extremes_unavailable'
    | 'compensation_pending'
    | 'failure_cooldown';
}

/**
 * failed エントリ。Position 単位で記録する。
 * `errorName` は `Error.prototype.name`（運用ログ用途で string プリミティブ）。
 */
export interface ExitDispatchFailEntry {
  readonly positionId: PositionId;
  readonly strategy: StrategyName;
  readonly errorName: string;
}

/**
 * `ExitDispatcher.dispatch` のバッチ集計結果。
 *
 * - `closed`: 決済が確定した Position の ID 一覧（broker + DB ともに成功）
 * - `skipped`: ExitRule が未登録で評価をスキップした Position（`MissingExitRuleError`）
 * - `failed`: ExitRule 評価 throw / 決済 API throw 等で決済できなかった Position
 *
 * Note (不変性):
 *   `of` で受け取った配列は shallow copy を取る。各要素（`PositionId` / `StrategyName` は VO・不変、
 *   `errorName` は string プリミティブ）は元から不変なので、deep copy は不要。
 *
 * 設計書: docs/design/position-manager/step8-brief.md 5.2。
 */
export class ExitDispatchResult {
  private constructor(
    readonly closed: readonly PositionId[],
    readonly skipped: readonly ExitDispatchSkipEntry[],
    readonly failed: readonly ExitDispatchFailEntry[],
  ) {}

  static of(params: {
    closed: readonly PositionId[];
    skipped: readonly ExitDispatchSkipEntry[];
    failed: readonly ExitDispatchFailEntry[];
  }): ExitDispatchResult {
    return new ExitDispatchResult(
      [...params.closed],
      [...params.skipped],
      [...params.failed],
    );
  }

  static empty(): ExitDispatchResult {
    return new ExitDispatchResult([], [], []);
  }

  /** いずれかの Position で失敗があるか。 */
  hasFailure(): boolean {
    return this.failed.length > 0;
  }

  /**
   * 「永続スキップ」（`reason: 'rule_missing'`）が含まれるか。
   * これが true の間は当該 Position が決済されないため、運用検知の起点として使う。
   * `extremes_unavailable` は次 tick 再評価で解消する一時状態なので含めない。
   */
  hasPermanentSkip(): boolean {
    return this.skipped.some((s) => s.reason === 'rule_missing');
  }
}
