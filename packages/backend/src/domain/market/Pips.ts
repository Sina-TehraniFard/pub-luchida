import Big from 'big.js';

export class Pips {
  private constructor(private readonly value: Big) {}

  static of(value: string): Pips {
    return new Pips(new Big(value));
  }

  isPositive(): boolean {
    return this.value.gt(0);
  }

  isNegative(): boolean {
    return this.value.lt(0);
  }

  isGreaterThan(other: Pips): boolean {
    return this.value.gt(other.value);
  }

  abs(): Pips {
    return Pips.of(this.value.abs().toFixed());
  }

  /** @internal */
  toBig(): Big {
    return this.value;
  }

  equals(other: Pips): boolean {
    return this.value.eq(other.value);
  }

  toString(): string {
    return this.value.toFixed();
  }
}
