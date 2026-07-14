import type { Lot } from './Lot.js';
import type { LotDecisionInput } from './LotDecisionInput.js';

/**
 * ロット計算の純粋ドメインサービス。
 *
 * LotDecisionInput を受け取って Lot を返すだけの純関数として実装する。
 * I/O（残高取得・レート取得）は呼び出し側（PositionSizingService）が
 * LotDecisionInput を組み立てる時点で済ませる。
 *
 * 設計書: docs/design/position-manager/policies.md 1 章。
 */
export interface LotPolicy {
  decide(input: LotDecisionInput): Lot;
}
