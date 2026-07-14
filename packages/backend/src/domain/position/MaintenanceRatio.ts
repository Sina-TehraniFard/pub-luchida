import Big from 'big.js';

/**
 * エントリー時に狙う証拠金維持率の目標値（例: 1.4 = 140%）。
 *
 * 1.0 以下は強制決済ラインを下回るため、目標値として許容しない。
 */
export class MaintenanceRatio {
  private constructor(private readonly value: Big) {}

  static of(value: number | string): MaintenanceRatio {
    const v = new Big(value);
    if (v.lte(1)) {
      throw new Error(`MaintenanceRatio は 1.0 超: ${value}`);
    }
    return new MaintenanceRatio(v);
  }

  toNumber(): number {
    return this.value.toNumber();
  }

  /** @internal */
  toBig(): Big {
    return this.value;
  }

  equals(other: MaintenanceRatio): boolean {
    return this.value.eq(other.value);
  }

  toString(): string {
    return this.value.toFixed();
  }
}
