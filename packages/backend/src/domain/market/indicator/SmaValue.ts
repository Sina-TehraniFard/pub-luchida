import Big from 'big.js';

export class SmaValue {
  private constructor(private readonly value: Big) {}

  static of(value: string): SmaValue {
    const v = new Big(value);
    if (v.lte(0)) {
      throw new Error(`SMA は正の数: ${value}`);
    }
    return new SmaValue(v);
  }

  /** この SMA が other より上か */
  isAbove(other: SmaValue): boolean {
    return this.value.gt(other.value);
  }

  /** この SMA が other より下か */
  isBelow(other: SmaValue): boolean {
    return this.value.lt(other.value);
  }

  equals(other: SmaValue): boolean {
    return this.value.eq(other.value);
  }

  toString(): string {
    return this.value.toFixed();
  }
}
