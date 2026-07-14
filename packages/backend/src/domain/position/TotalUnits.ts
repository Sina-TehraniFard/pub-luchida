import Big from 'big.js';
import { Lot } from './Lot.js';

/**
 * 戦略ごとの Lot を合算した合計建玉数を表す値オブジェクト。
 *
 * 単一 Lot は 100〜500,000 だが、複数戦略の合算では 500,000 を超えうるため、
 * Lot とは別の VO として独立させている。
 * 上限超は実行時バリデーションではなく isExceedingSingleLotLimit() で利用側に判定させる。
 *
 * 設計書: docs/design/value-objects.md L1182-1237。
 */
export class TotalUnits {
  private constructor(private readonly value: Big) {}

  static of(value: number | string): TotalUnits {
    const v = new Big(value);
    if (v.lt(0)) {
      throw new Error(`TotalUnits は非負: ${value}`);
    }
    if (!v.mod(1).eq(0)) {
      throw new Error(`TotalUnits は整数: ${value}`);
    }
    return new TotalUnits(v);
  }

  static zero(): TotalUnits {
    return new TotalUnits(new Big(0));
  }

  static fromLot(lot: Lot): TotalUnits {
    return new TotalUnits(new Big(lot.toNumber()));
  }

  plus(other: TotalUnits): TotalUnits {
    return new TotalUnits(this.value.plus(other.value));
  }

  isExceedingSingleLotLimit(): boolean {
    return this.value.gt(new Big(Lot.SINGLE_LOT_MAX_UNITS));
  }

  /** @internal */
  toBig(): Big {
    return this.value;
  }

  toNumber(): number {
    return this.value.toNumber();
  }

  equals(other: TotalUnits): boolean {
    return this.value.eq(other.value);
  }

  toString(): string {
    return this.value.toFixed();
  }
}
