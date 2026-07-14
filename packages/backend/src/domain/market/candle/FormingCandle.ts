import { Price } from '../Price.js';
import { Tick } from '../tick/Tick.js';
import { TimeFrame } from '../TimeFrame.js';
import { CandleCloseTime } from './CandleCloseTime.js';
import { CandleEvent } from './CandleEvent.js';
import { CandleOpenTime } from './CandleOpenTime.js';
import { ConfirmedCandle } from './ConfirmedCandle.js';

/**
 * 現在形成中のローソク足。
 * tick が来るたびに高値・安値・終値が更新される、例外的に可変なドメインオブジェクト。
 */
export class FormingCandle {
  private _high: Price;
  private _low: Price;
  private _close: Price;
  private _confirmed: boolean = false;

  private constructor(
    private readonly _open: Price,
    private readonly _openTime: CandleOpenTime,
    private readonly _timeFrame: TimeFrame,
    high: Price,
    low: Price,
    close: Price,
  ) {
    this._high = high;
    this._low = low;
    this._close = close;
  }

  /**
   * 最初の tick で足を開く。
   * open / high / low / close はすべて firstTick の bid() で初期化される。
   * GMO klines API が BID 価格を返すため、足の価格ソースを bid に統一する。
   */
  static open(firstTick: Tick, timeFrame: TimeFrame): FormingCandle {
    const bid = firstTick.bid();
    const openTime = CandleOpenTime.of(firstTick.timestamp().toDate());
    return new FormingCandle(bid, openTime, timeFrame, bid, bid, bid);
  }

  /**
   * tick の bid() で high / low / close を更新する。
   * - high: max(現high, bid)
   * - low:  min(現low,  bid)
   * - close: bid（常に最新）
   * GMO klines API が BID 価格を返すため、足の価格ソースを bid に統一する。
   */
  update(tick: Tick): CandleEvent {
    if (this._confirmed) {
      throw new Error('確定済みの足に update() を呼ぶことはできません');
    }
    const bid = tick.bid();
    if (bid.isHigherThan(this._high)) {
      this._high = bid;
    }
    if (this._low.isHigherThan(bid)) {
      this._low = bid;
    }
    this._close = bid;
    return CandleEvent.updated();
  }

  /**
   * 足を確定する。
   * FormingCandle 自体は変化しない。
   * 確定後の ConfirmedCandle は toConfirmed() で取得する。
   */
  confirm(_closeTime: CandleCloseTime): CandleEvent {
    this._confirmed = true;
    return CandleEvent.confirmed();
  }

  /**
   * 現在の状態を ConfirmedCandle として返す。
   */
  toConfirmed(closeTime: CandleCloseTime): ConfirmedCandle {
    return ConfirmedCandle.of({
      open: this._open,
      high: this._high,
      low: this._low,
      close: this._close,
      openTime: this._openTime,
      closeTime,
      timeFrame: this._timeFrame,
    });
  }

  /** 現在の close 価格 */
  currentClose(): Price {
    return this._close;
  }

  /** 現在の high */
  currentHigh(): Price {
    return this._high;
  }

  /** 現在の low */
  currentLow(): Price {
    return this._low;
  }

  /** open 価格（変わらない） */
  openPrice(): Price {
    return this._open;
  }

  /** 足の開始時刻 */
  openTime(): CandleOpenTime {
    return this._openTime;
  }

  /** 時間足 */
  timeFrame(): TimeFrame {
    return this._timeFrame;
  }
}
