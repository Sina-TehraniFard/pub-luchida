import { strategyNameEquals, type StrategyName } from './StrategyName.js';

/**
 * EntryRule 群の評価結果として「シグナルが発火した戦略の集合」をまとめた値オブジェクト。
 * AllocationContext の入力として PositionManager から AllocationPolicy へ渡される。
 *
 * - 重複なし（同じ戦略が 2 回入らない。判定は strategyNameEquals 経由）
 * - 順序は安定（評価順を保つ）
 *   この順序は EqualWeightAllocationPolicy の残余寄せで「末尾戦略にどれが来るか」を
 *   直接決定する。PositionManager 側で組み立てる際は決定論的順序になるよう揃えること。
 * - 生成後は変更不可
 *
 * 設計書: docs/design/value-objects.md DetectedSignals 章。
 */
export class DetectedSignals {
  private constructor(private readonly strategiesValue: readonly StrategyName[]) {}

  static of(strategies: StrategyName[]): DetectedSignals {
    const seen: StrategyName[] = [];
    for (const s of strategies) {
      if (seen.some((existing) => strategyNameEquals(existing, s))) {
        throw new Error(`DetectedSignals に重複した戦略: ${s}`);
      }
      seen.push(s);
    }
    return new DetectedSignals([...strategies]);
  }

  static empty(): DetectedSignals {
    return new DetectedSignals([]);
  }

  contains(strategy: StrategyName): boolean {
    return this.strategiesValue.some((s) => strategyNameEquals(s, strategy));
  }

  size(): number {
    return this.strategiesValue.length;
  }

  isEmpty(): boolean {
    return this.strategiesValue.length === 0;
  }

  /** 防御的コピーを返す（戻り型 readonly で外部からの破壊的変更を型レベルで禁止） */
  strategies(): readonly StrategyName[] {
    return [...this.strategiesValue];
  }

  /** 各戦略に対して処理を実行する。配列複製を強要しない走査用 API */
  forEach(consumer: (strategy: StrategyName) => void): void {
    this.strategiesValue.forEach(consumer);
  }

  equals(other: DetectedSignals): boolean {
    if (this.strategiesValue.length !== other.strategiesValue.length) return false;
    return this.strategiesValue.every((s, i) => strategyNameEquals(s, other.strategiesValue[i]));
  }

  toString(): string {
    return `DetectedSignals(${this.strategiesValue.join(', ')})`;
  }
}
