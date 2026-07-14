import Big from 'big.js';
import type { Ratio } from './Ratio.js';

/**
 * Ratio.addUnchecked / 残余寄せ等の中間合算で使う、制約のない比率合計を表す値オブジェクト。
 *
 * Ratio (0.0〜1.0 不変条件) を破らずに「合計が 1.0 を超えうる中間値」を表現するため、
 * 別の型として独立させている。LotAllocation.of の合計検証で利用する。
 *
 * 設計書: docs/design/value-objects.md セクション 6.1-6.11 (Ratio L759-829, BigSum L844 周辺)
 */
export class BigSum {
  private constructor(private readonly value: Big) {}

  static zero(): BigSum {
    return new BigSum(new Big(0));
  }

  static fromRatio(ratio: Ratio): BigSum {
    return new BigSum(ratio.toBig());
  }

  /** Ratio を加算した新しい BigSum を返す（BigSum 自体は不変） */
  addRatio(ratio: Ratio): BigSum {
    return new BigSum(this.value.plus(ratio.toBig()));
  }

  /** BigSum 同士の加算（残余寄せ等で使う） */
  add(other: BigSum): BigSum {
    return new BigSum(this.value.plus(other.value));
  }

  /**
   * |this - 1.0| <= epsilon を判定する。LotAllocation.of の合計検証で使う。
   */
  isApproximatelyOne(epsilon: Big): boolean {
    return this.value.minus(1).abs().lte(epsilon);
  }

  // LotAllocation.of の合計検証で使用
  /** @internal */
  toBig(): Big {
    return this.value;
  }

  equals(other: BigSum): boolean {
    return this.value.eq(other.value);
  }

  toString(): string {
    return this.value.toFixed();
  }
}
