import type { AllocationContext } from './AllocationContext.js';
import type { LotAllocation } from './LotAllocation.js';

/**
 * 検知シグナル・保有ポジション・残高から戦略ごとの配分比率（LotAllocation）を返す
 * 判断ロジック（ドメインサービス）。
 *
 * 契約:
 * - 同一 AllocationContext に対して同一 LotAllocation を返す（決定的）
 * - I/O・時刻参照・乱数・状態保持を持たない純粋な判断ロジック
 * - throw はドメイン不変条件違反時のみ（合計検証失敗等）
 *
 * 初期実装: EqualWeightAllocationPolicy（等ウェイト + 残余寄せ）。
 * 将来: ConvictionWeightedAllocationPolicy / FixedRatioAllocationPolicy などを差し替え可能。
 *
 * 設計書: docs/design/position-manager/brief.md 5.2、docs/design/value-objects.md。
 */
export interface AllocationPolicy {
  decide(context: AllocationContext): LotAllocation;
}
