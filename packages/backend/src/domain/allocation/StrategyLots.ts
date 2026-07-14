import { StrategyName, type StrategyNameValue } from '../rule/StrategyName.js';
import { Lot } from '../position/Lot.js';
import type { Ratio } from '../Ratio.js';
import { TotalUnits } from '../position/TotalUnits.js';

/**
 * 戦略ごとに発注すべき Lot をまとめた値オブジェクト。
 *
 * - `LotAllocation.apply(baseLot)` の戻り値型。
 * - 内部表現は `Map<StrategyNameValue, Lot>`（外部に生 Map を露出させない）。
 * - 各 Lot は `Lot.of` を通った正常値（100〜500,000 の 100 倍数）。
 * - `Ratio.zero()` で抑制された戦略は含まれない（fromAllocation 時に除外）。
 * - 生成後は変更不可（Mutator なし）。
 *
 * 設計書: docs/design/value-objects.md L1241-1299。
 */
export class StrategyLots {
  private constructor(private readonly lots: ReadonlyMap<StrategyNameValue, Lot>) {}

  static fromAllocation(
    ratios: Map<StrategyNameValue, Ratio>,
    baseLot: Lot,
  ): StrategyLots {
    const inner = new Map<StrategyNameValue, Lot>();
    for (const [strategyValue, ratio] of ratios) {
      if (ratio.isZero()) continue;
      inner.set(strategyValue, ratio.applyTo(baseLot));
    }
    return new StrategyLots(inner);
  }

  lotOf(strategy: StrategyName): Lot | null {
    return this.lots.get(strategy) ?? null;
  }

  strategies(): StrategyName[] {
    return Array.from(this.lots.keys()).map((v) => StrategyName(v));
  }

  totalLot(): TotalUnits {
    let total = TotalUnits.zero();
    for (const lot of this.lots.values()) {
      total = total.plus(TotalUnits.fromLot(lot));
    }
    return total;
  }

  isEmpty(): boolean {
    return this.lots.size === 0;
  }

  equals(other: StrategyLots): boolean {
    if (this.lots.size !== other.lots.size) return false;
    for (const [k, v] of this.lots) {
      const o = other.lots.get(k);
      if (o == null || !v.equals(o)) return false;
    }
    return true;
  }

  toString(): string {
    const entries = Array.from(this.lots.entries())
      .map(([s, lot]) => `${s}=${lot.toString()}`)
      .join(', ');
    return `StrategyLots(${entries})`;
  }
}
