import Big from 'big.js';

/**
 * ADX（Average Directional Index）の値。トレンドの「強さ」を 0–100 で表す。
 * 方向（上昇/下降）は持たない。方向は DiPlus / DiMinus で判断する。
 *
 * number を画面まで素通しさせないための値オブジェクト。端数誤差を避けるため
 * 内部は Big で保持する。
 */
export class AdxValue {
  /** トレンド弱の閾値（Wilder の慣例）。これ未満は明確なトレンドがない。 */
  private static readonly WEAK_TREND_THRESHOLD = new Big(20);

  /** 非常に強いトレンドの閾値（Wilder の慣例）。これ以上は非常に強いトレンド。 */
  private static readonly VERY_STRONG_TREND_THRESHOLD = new Big(40);

  private constructor(private readonly value: Big) {}

  /**
   * @param value 0–100 の ADX 値（文字列）。
   */
  static of(value: string): AdxValue {
    const v = new Big(value);
    if (v.lt(0) || v.gt(100)) {
      throw new Error(`ADX は 0–100 の範囲: ${value}`);
    }
    return new AdxValue(v);
  }

  /** トレンドが弱いか（ADX < 20、Wilder の慣例）。 */
  isWeakTrend(): boolean {
    return this.value.lt(AdxValue.WEAK_TREND_THRESHOLD);
  }

  /** トレンドが非常に強いか（ADX ≥ 40、Wilder の慣例）。 */
  isVeryStrongTrend(): boolean {
    return this.value.gte(AdxValue.VERY_STRONG_TREND_THRESHOLD);
  }

  /** 小数 fractionDigits 桁に丸めた表示文字列。 */
  toFixed(fractionDigits: number): string {
    return this.value.toFixed(fractionDigits);
  }

  equals(other: AdxValue): boolean {
    return this.value.eq(other.value);
  }

  toString(): string {
    return this.value.toFixed();
  }
}
