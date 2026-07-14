import { Price } from '../Price.js';
import { TimeFrame } from '../TimeFrame.js';
import { CandleCloseTime } from './CandleCloseTime.js';
import { CandleOpenTime } from './CandleOpenTime.js';

interface ConfirmedCandleParams {
  open: Price;
  high: Price;
  low: Price;
  close: Price;
  openTime: CandleOpenTime;
  closeTime: CandleCloseTime;
  timeFrame: TimeFrame;
}

/**
 * 確定済みのローソク足。
 * 一度生成されたら変わらない値オブジェクト。
 */
export class ConfirmedCandle {
  readonly open: Price;
  readonly high: Price;
  readonly low: Price;
  readonly close: Price;
  readonly openTime: CandleOpenTime;
  readonly closeTime: CandleCloseTime;
  readonly timeFrame: TimeFrame;

  private constructor(params: ConfirmedCandleParams) {
    this.open = params.open;
    this.high = params.high;
    this.low = params.low;
    this.close = params.close;
    this.openTime = params.openTime;
    this.closeTime = params.closeTime;
    this.timeFrame = params.timeFrame;
  }

  static of(params: ConfirmedCandleParams): ConfirmedCandle {
    const { open, high, low, close } = params;

    if (high.isHigherThan(open) === false && !high.equals(open)) {
      throw new Error(`high は open 以上である必要があります: high=${high}, open=${open}`);
    }
    if (high.isHigherThan(close) === false && !high.equals(close)) {
      throw new Error(`high は close 以上である必要があります: high=${high}, close=${close}`);
    }
    if (low.isHigherThan(open)) {
      throw new Error(`low は open 以下である必要があります: low=${low}, open=${open}`);
    }
    if (low.isHigherThan(close)) {
      throw new Error(`low は close 以下である必要があります: low=${low}, close=${close}`);
    }
    if (high.isHigherThan(low) === false && !high.equals(low)) {
      throw new Error(`high は low 以上である必要があります: high=${high}, low=${low}`);
    }

    const { openTime, closeTime } = params;
    if (openTime.toDate().getTime() >= closeTime.toDate().getTime()) {
      throw new Error(
        `openTime は closeTime より前である必要があります: openTime=${openTime}, closeTime=${closeTime}`,
      );
    }

    return new ConfirmedCandle(params);
  }

  /** 陽線か（close >= open） */
  isBullish(): boolean {
    return this.close.isHigherThan(this.open) || this.close.equals(this.open);
  }

  /** 陰線か（close < open） */
  isBearish(): boolean {
    return this.open.isHigherThan(this.close);
  }

  /**
   * 実体の大きさ（|close - open|）。
   * 同値線（close === open）の場合は open をそのまま返す（実体サイズ 0 は Price が扱えないため）。
   * @internal toBig() の使用は同一 domain 内のため許容。
   */
  bodySize(): Price {
    if (this.close.equals(this.open)) {
      return this.open;
    }
    return Price.of(this.close.minus(this.open).toBig().abs().toFixed());
  }

  equals(other: ConfirmedCandle): boolean {
    return (
      this.open.equals(other.open) &&
      this.high.equals(other.high) &&
      this.low.equals(other.low) &&
      this.close.equals(other.close) &&
      this.openTime.equals(other.openTime) &&
      this.closeTime.equals(other.closeTime) &&
      this.timeFrame === other.timeFrame
    );
  }
}
