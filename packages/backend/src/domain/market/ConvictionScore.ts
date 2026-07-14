import Big from 'big.js';

export class ConvictionScore {
  private constructor(private readonly value: Big) {}

  static of(value: string): ConvictionScore {
    const v = new Big(value);
    if (v.lt(0) || v.gt(1)) {
      throw new Error(`確信度は 0.0〜1.0 の範囲: ${value}`);
    }
    return new ConvictionScore(v);
  }

  static zero(): ConvictionScore {
    return new ConvictionScore(new Big('0'));
  }

  static full(): ConvictionScore {
    return new ConvictionScore(new Big('1'));
  }

  isHighEnough(threshold: ConvictionScore): boolean {
    return this.value.gte(threshold.value);
  }

  equals(other: ConvictionScore): boolean {
    return this.value.eq(other.value);
  }

  toString(): string {
    return this.value.toFixed();
  }
}
