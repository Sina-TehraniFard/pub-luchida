export class Lot {
  /** 単一 Lot の下限値（GMO の単一発注下限）。LotPolicy 等から参照される */
  static readonly SINGLE_LOT_MIN_UNITS = 100;
  /** 単一 Lot の上限値（GMO の単一発注上限）。TotalUnits 等から参照される */
  static readonly SINGLE_LOT_MAX_UNITS = 500_000;

  private constructor(private readonly value: number) {}

  static of(value: number): Lot {
    if (!Number.isInteger(value)) {
      throw new Error(`Lotは整数: ${value}`);
    }
    if (value < Lot.SINGLE_LOT_MIN_UNITS) {
      throw new Error(`Lotは${Lot.SINGLE_LOT_MIN_UNITS}以上: ${value}`);
    }
    if (value > Lot.SINGLE_LOT_MAX_UNITS) {
      throw new Error(`Lotは${Lot.SINGLE_LOT_MAX_UNITS.toLocaleString()}以下: ${value}`);
    }
    if (value % 100 !== 0) {
      throw new Error(`Lotは100の倍数: ${value}`);
    }
    return new Lot(value);
  }

  toNumber(): number {
    return this.value;
  }

  equals(other: Lot): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return String(this.value);
  }
}
