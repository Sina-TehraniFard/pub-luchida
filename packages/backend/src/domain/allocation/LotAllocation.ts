import { StrategyName, type StrategyNameValue } from '../rule/StrategyName.js';
import { Ratio } from '../Ratio.js';
import { BigSum } from '../BigSum.js';
import { Lot } from '../position/Lot.js';
import { StrategyLots } from './StrategyLots.js';

/**
 * 戦略ごとの Lot 配分比率をまとめた値オブジェクト。
 *
 * - `AllocationPolicy.decide()` の計算結果。
 * - 内部表現は `Map<StrategyNameValue, Ratio>`（外部に生 Map を露出させない）。
 * - 比率の合計は 1.0、かつ `|sum - 1.0| <= Ratio.EPSILON`（1e-9）以内でなければならない。
 *   ただし全戦略がゼロ比率の場合のみ合計 0.0 を許容（「今サイクルは発注しない」表明）。
 * - 各比率は 0.0〜1.0（Ratio 側で保証）。
 * - 生成後は変更不可（Mutator なし）。
 *
 * 設計書: docs/design/value-objects.md L674-755。
 */
export class LotAllocation {
  private constructor(private readonly ratios: ReadonlyMap<StrategyNameValue, Ratio>) {}

  /**
   * 戦略 → Ratio のマップから LotAllocation を生成する。
   * 合計が 1.0 から `Ratio.EPSILON` を超えてずれていればエラー。
   * 全戦略がゼロ比率の場合のみ合計 0.0 を許容する。
   */
  static of(entries: Map<StrategyName, Ratio>): LotAllocation {
    const inner = new Map<StrategyNameValue, Ratio>();
    let sum: BigSum = BigSum.zero();
    let allZero = true;
    for (const [strategy, ratio] of entries) {
      if (inner.has(strategy)) {
        throw new Error(
          `LotAllocation に重複した戦略が含まれています: ${strategy}`,
        );
      }
      inner.set(strategy, ratio);
      sum = sum.addRatio(ratio);
      if (!ratio.isZero()) allZero = false;
    }
    if (!allZero && !sum.isApproximatelyOne(Ratio.EPSILON)) {
      throw new Error(
        `LotAllocation の比率合計は 1.0 ± EPSILON: sum=${sum.toString()}`,
      );
    }
    return new LotAllocation(inner);
  }

  /**
   * 全戦略を抑制した LotAllocation を生成する。
   * 「今サイクルは発注しない」表明として使う。
   */
  static suppressed(strategies: readonly StrategyName[]): LotAllocation {
    const inner = new Map<StrategyNameValue, Ratio>();
    for (const s of strategies) inner.set(s, Ratio.zero());
    return new LotAllocation(inner);
  }

  /** 指定戦略の比率。含まれない戦略は `Ratio.zero()` を返す */
  ratioOf(strategy: StrategyName): Ratio {
    return this.ratios.get(strategy) ?? Ratio.zero();
  }

  /** 指定戦略がゼロ比率（含まれない場合も含む）か判定する */
  isSuppressed(strategy: StrategyName): boolean {
    return this.ratioOf(strategy).isZero();
  }

  /** 全戦略がゼロ比率か判定する */
  isFullySuppressed(): boolean {
    return Array.from(this.ratios.values()).every((r) => r.isZero());
  }

  /** baseLot に比率を適用して StrategyLots を返す */
  apply(baseLot: Lot): StrategyLots {
    return StrategyLots.fromAllocation(new Map(this.ratios), baseLot);
  }

  /** 配分対象（非ゼロ）の戦略一覧を返す */
  strategies(): StrategyName[] {
    return Array.from(this.ratios.entries())
      .filter(([, r]) => !r.isZero())
      .map(([v]) => StrategyName(v));
  }

  equals(other: LotAllocation): boolean {
    if (this.ratios.size !== other.ratios.size) return false;
    for (const [k, v] of this.ratios) {
      const o = other.ratios.get(k);
      if (o == null || !v.equals(o)) return false;
    }
    return true;
  }

  toString(): string {
    const entries = Array.from(this.ratios.entries())
      .map(([s, r]) => `${s}=${r.toString()}`)
      .join(', ');
    return `LotAllocation(${entries})`;
  }
}
