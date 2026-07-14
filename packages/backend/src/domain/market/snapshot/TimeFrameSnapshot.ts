import { ConfirmedCandle } from '../candle/ConfirmedCandle.js';
import { FormingCandle } from '../candle/FormingCandle.js';
import { IndicatorValues } from '../indicator/IndicatorValues.js';
import { TimeFrame } from '../TimeFrame.js';

/**
 * 特定の時間足の市場断面。
 * ある時点における、その時間足の確定済み最新足・形成中足・指標値をまとめて持つ。
 * Rule がシグナル判定に使う「材料」の一つ。
 */
export class TimeFrameSnapshot {
  private constructor(
    readonly timeFrame: TimeFrame,
    readonly confirmed: ConfirmedCandle,
    readonly forming: FormingCandle,
    readonly indicators: IndicatorValues,
  ) {}

  static of(params: {
    timeFrame: TimeFrame;
    confirmed: ConfirmedCandle;
    forming: FormingCandle;
    indicators: IndicatorValues;
  }): TimeFrameSnapshot {
    if (params.confirmed.timeFrame !== params.timeFrame) {
      throw new Error(`confirmed の timeFrame が一致しません`);
    }
    if (params.forming.timeFrame() !== params.timeFrame) {
      throw new Error(`forming の timeFrame が一致しません`);
    }
    return new TimeFrameSnapshot(
      params.timeFrame,
      params.confirmed,
      params.forming,
      params.indicators,
    );
  }

  /**
   * 指定した timeFrame と一致するか。
   * TimeFrameBook が特定の時間足のスナップショットを取得するのに使う。
   */
  isFor(timeFrame: TimeFrame): boolean {
    return this.timeFrame === timeFrame;
  }

  equals(other: TimeFrameSnapshot): boolean {
    return (
      this.timeFrame === other.timeFrame &&
      this.confirmed.equals(other.confirmed) &&
      this.forming.timeFrame() === other.forming.timeFrame() &&
      this.forming.openTime().equals(other.forming.openTime()) &&
      this.forming.currentClose().equals(other.forming.currentClose()) &&
      this.forming.currentHigh().equals(other.forming.currentHigh()) &&
      this.forming.currentLow().equals(other.forming.currentLow()) &&
      this.forming.openPrice().equals(other.forming.openPrice()) &&
      this.indicators.equals(other.indicators)
    );
  }
}
