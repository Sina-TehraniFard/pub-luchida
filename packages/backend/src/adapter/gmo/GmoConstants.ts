import { MarginRate } from '../../domain/position/MarginRate.js';

/**
 * GMO FX 業者依存の定数を集約する。
 *
 * ドメイン VO に業者名を漏らさない方針のため、業者依存値はこの infrastructure 境界
 * （adapter/gmo/）の constants ファイルから注入する。
 *
 * 設計書: docs/design/position-manager/policies.md 1.7。
 */
export const GmoConstants = {
  /**
   * 国内ユーザーの証拠金率（= 1 / 25 倍レバレッジ）。
   */
  MARGIN_RATE: MarginRate.of('0.04'),
} as const;
