import { SmaValue } from './SmaValue.js';

/**
 * SMAの現在値セット。
 * 短期・長期の現在値と前回値を持つ。
 * ゴールデンクロス / デッドクロスの判定に使う。
 */
export class SmaSnapshot {
  private constructor(
    readonly shortSma: SmaValue,
    readonly longSma: SmaValue,
    readonly previousShortSma: SmaValue,
    readonly previousLongSma: SmaValue,
  ) {}

  static of(params: {
    shortSma: SmaValue;
    longSma: SmaValue;
    previousShortSma: SmaValue;
    previousLongSma: SmaValue;
  }): SmaSnapshot {
    return new SmaSnapshot(
      params.shortSma,
      params.longSma,
      params.previousShortSma,
      params.previousLongSma,
    );
  }

  equals(other: SmaSnapshot): boolean {
    return (
      this.shortSma.equals(other.shortSma) &&
      this.longSma.equals(other.longSma) &&
      this.previousShortSma.equals(other.previousShortSma) &&
      this.previousLongSma.equals(other.previousLongSma)
    );
  }
}
