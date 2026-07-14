import Big from 'big.js';

/**
 * 証拠金率（= 1 / レバレッジ）。
 *
 * 例: GMO FX 国内ユーザーは 0.04（レバレッジ 25 倍）固定。
 *
 * 業者依存値（0.04 など）は infrastructure 側のコンフィグで定義し、
 * `MarginRate.of(...)` を介してドメインに注入する。
 * ドメイン VO に業者名を漏らさない方針のため、`gmoFxRetail()` 等の
 * 業者依存ファクトリは提供しない。
 */
export class MarginRate {
  private constructor(private readonly value: Big) {}

  static of(value: number | string): MarginRate {
    const v = new Big(value);
    if (v.lte(0) || v.gte(1)) {
      throw new Error(`MarginRate は 0 超 1 未満: ${value}`);
    }
    return new MarginRate(v);
  }

  toNumber(): number {
    return this.value.toNumber();
  }

  /** @internal */
  toBig(): Big {
    return this.value;
  }

  /**
   * レバレッジ換算値（= 1 / value）を返す。表示・ログ用途。
   */
  leverageEquivalent(): number {
    return new Big(1).div(this.value).toNumber();
  }

  equals(other: MarginRate): boolean {
    return this.value.eq(other.value);
  }

  toString(): string {
    return this.value.toFixed();
  }
}
