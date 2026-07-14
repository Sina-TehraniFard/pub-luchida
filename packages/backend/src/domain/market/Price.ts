import Big from 'big.js';

export class Price {
  private constructor(private readonly value: Big) {}

  static of(value: string): Price {
    const v = new Big(value);
    if (v.lte(0)) {
      throw new Error(`価格は正の数: ${value}`);
    }
    return new Price(v);
  }

  minus(other: Price): Price {
    const result = this.value.minus(other.value);
    return new Price(result);
  }

  midBetween(other: Price): Price {
    // big.js デフォルト（ROUND_HALF_UP）で丸める。
    // FX の仲値計算ルールはブローカーにより異なるが、
    // このシステムでは参考値として使用するためデフォルトで十分。
    const result = this.value.plus(other.value).div(2);
    return new Price(result);
  }

  isHigherThan(other: Price): boolean {
    return this.value.gt(other.value);
  }

  /** @internal */
  toBig(): Big {
    return this.value;
  }

  equals(other: Price): boolean {
    return this.value.eq(other.value);
  }

  toString(): string {
    return this.value.toFixed();
  }
}
