import Big from 'big.js';

/**
 * 方向性指数（Directional Indicator）の基底。+DI / −DI の共通実装。
 *
 * 0–100 の値で、+DI が −DI を上回れば上昇方向、下回れば下降方向の勢いが強い。
 * +DI と −DI を別クラスに分け、取り違え（上昇と下降の誤読）を型で防ぐ。
 */
abstract class DiValue {
  protected constructor(protected readonly value: Big) {}

  /** この DI が other（反対方向の DI）より大きいか。 */
  protected isGreaterThan(other: DiValue): boolean {
    return this.value.gt(other.value);
  }

  /** 小数 fractionDigits 桁に丸めた表示文字列。 */
  toFixed(fractionDigits: number): string {
    return this.value.toFixed(fractionDigits);
  }

  toString(): string {
    return this.value.toFixed();
  }
}

/**
 * +DI（上昇方向の強さ）。
 */
export class DiPlus extends DiValue {
  static of(value: string): DiPlus {
    const v = new Big(value);
    if (v.lt(0) || v.gt(100)) {
      throw new Error(`+DI は 0–100 の範囲: ${value}`);
    }
    return new DiPlus(v);
  }

  /** +DI が −DI を上回っているか（上昇方向の勢いが優勢か）。 */
  isStrongerThan(minus: DiMinus): boolean {
    return this.isGreaterThan(minus);
  }

  equals(other: DiPlus): boolean {
    return this.value.eq(other.value);
  }
}

/**
 * −DI（下降方向の強さ）。
 */
export class DiMinus extends DiValue {
  static of(value: string): DiMinus {
    const v = new Big(value);
    if (v.lt(0) || v.gt(100)) {
      throw new Error(`−DI は 0–100 の範囲: ${value}`);
    }
    return new DiMinus(v);
  }

  /** −DI が +DI を上回っているか（下降方向の勢いが優勢か）。 */
  isStrongerThan(plus: DiPlus): boolean {
    return this.isGreaterThan(plus);
  }

  equals(other: DiMinus): boolean {
    return this.value.eq(other.value);
  }
}
