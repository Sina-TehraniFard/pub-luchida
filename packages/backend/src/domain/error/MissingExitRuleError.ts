import type { StrategyName } from '../rule/StrategyName.js';

/**
 * `ExitRuleRegistry` に未登録の戦略を指定された場合のドメインエラー。
 *
 * 起動時 fail-fast 検証（main.ts）で「保有戦略 ⊆ Registry 登録戦略」を保証しているため、
 * 運用中の throw は「Rule 撤去後の OPEN ポジション」のような不整合シナリオでしか起こらない。
 *
 * `ExitDispatcher.dispatch` 内で捕捉して `LogPort.warn` + `skipped` 記録 + continue する。
 *
 * 設計書: docs/design/position-manager/step8-brief.md 5.1 / 5.7。
 */
export class MissingExitRuleError extends Error {
  private constructor(message: string, readonly strategyName: StrategyName) {
    super(message);
    this.name = 'MissingExitRuleError';
  }

  /**
   * 指定戦略が `ExitRuleRegistry` に未登録であることを表すエラー。
   * factory 名は `domain/error/` 配下の他クラス（`DuplicatePositionError.detectedByDomain` 等）
   * と同じく「発生事象を述語で示す」命名に揃える。
   */
  static notRegistered(strategyName: StrategyName): MissingExitRuleError {
    return new MissingExitRuleError(
      `ExitRuleRegistry に未登録の戦略: strategy=${strategyName}`,
      strategyName,
    );
  }
}
