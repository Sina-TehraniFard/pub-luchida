import type { AllocationPolicy } from './AllocationPolicy.js';
import type { AllocationContext } from './AllocationContext.js';
import { LotAllocation } from './LotAllocation.js';
import { Ratio } from '../Ratio.js';
import type { StrategyName } from '../rule/StrategyName.js';

/**
 * 検知された戦略すべてに等ウェイト配分する初期実装。
 *
 * - 同 pair × 同 strategy_name で既に OPEN 中の戦略は抑制（Ratio.zero）。重複ポジション防止。
 * - 残った eligible 戦略 n 個に対して残余寄せルールで合計=1.0 を厳密に保つ:
 *   - 先頭 n-1 戦略に r = Ratio.divideOne(n)
 *   - 末尾戦略に Ratio.complementOf(r, n-1)
 * - 検知ゼロ・全抑制の場合は LotAllocation.suppressed() を返す（isFullySuppressed() = true）。
 *
 * 合計ロット上限超過時は **PositionManager 側で全件 drop + LogPort.warn** が確定方針
 * （policies.md 1.11）。本 Policy は事前スケールダウンを行わない。
 *
 * 設計書: docs/design/position-manager/brief.md 5.2 / docs/design/position-manager/policies.md 1.4.1。
 */
export class EqualWeightAllocationPolicy implements AllocationPolicy {
  decide(context: AllocationContext): LotAllocation {
    const detected = context.detectedSignals().strategies();
    if (detected.length === 0) {
      return LotAllocation.suppressed([]);
    }

    const positions = context.currentPositions();
    const pair = context.pair();
    const suppressed: StrategyName[] = [];
    const eligible: StrategyName[] = [];
    for (const s of detected) {
      if (positions.holdsStrategyOnPair(pair, s)) suppressed.push(s);
      else eligible.push(s);
    }

    if (eligible.length === 0) {
      return LotAllocation.suppressed(detected);
    }

    const ratios = this.computeEqualWeights(eligible.length);
    const entries = new Map<StrategyName, Ratio>();
    for (let i = 0; i < eligible.length; i++) {
      entries.set(eligible[i], ratios[i]);
    }
    for (const s of suppressed) {
      entries.set(s, Ratio.zero());
    }
    return LotAllocation.of(entries);
  }

  /**
   * n 戦略への等ウェイト比率を返す。
   * 先頭 n-1 個は Ratio.divideOne(n)、末尾は Ratio.complementOf(head, n-1) により
   * 合計 = 1.0（Ratio.SCALE 桁の範囲で厳密一致）を保つ。
   */
  private computeEqualWeights(n: number): Ratio[] {
    if (n === 1) return [Ratio.one()];
    const head = Ratio.divideOne(n);
    const last = Ratio.complementOf(head, n - 1);
    const result: Ratio[] = [];
    for (let i = 0; i < n - 1; i++) result.push(head);
    result.push(last);
    return result;
  }
}
