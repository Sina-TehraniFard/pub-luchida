import { CurrencyPair, currencyPairEquals } from '../CurrencyPair.js';
import { LIVE_TIMEFRAMES, TimeFrame } from '../TimeFrame.js';
import { Timestamp } from '../Timestamp.js';
import { Tick } from '../tick/Tick.js';
import { TimeFrameSnapshot } from './TimeFrameSnapshot.js';

/**
 * Rule に渡す市場の全断面写真。
 * 全TimeFrame（1分足・1時間足・日足）のスナップショット + 直近Tick を持つ。
 * このオブジェクトを見れば Rule がシグナル判定に必要な情報が全て揃う。
 */
export class MarketSnapshot {
  private constructor(
    private readonly timeFrames: ReadonlyMap<TimeFrame, TimeFrameSnapshot>,
    readonly tick: Tick,
    readonly pair: CurrencyPair,
    readonly capturedAt: Timestamp,
  ) {}

  static of(params: {
    timeFrames: ReadonlyMap<TimeFrame, TimeFrameSnapshot>;
    tick: Tick;
    pair: CurrencyPair;
    capturedAt: Timestamp;
  }): MarketSnapshot {
    for (const tf of LIVE_TIMEFRAMES) {
      if (!params.timeFrames.has(tf)) {
        throw new Error(`MarketSnapshot: 必須の TimeFrame が不足しています: ${tf}`);
      }
    }
    return new MarketSnapshot(params.timeFrames, params.tick, params.pair, params.capturedAt);
  }

  /**
   * 指定した TimeFrame のスナップショットを取得する。
   * 存在しない TimeFrame を要求した場合は Error をスロー。
   */
  snapshotOf(timeFrame: TimeFrame): TimeFrameSnapshot {
    const snapshot = this.timeFrames.get(timeFrame);
    if (snapshot === undefined) {
      throw new Error(
        `MarketSnapshot: 指定した TimeFrame のスナップショットが存在しません: timeFrame=${timeFrame}`,
      );
    }
    return snapshot;
  }

  equals(other: MarketSnapshot): boolean {
    if (!this.tick.equals(other.tick)) return false;
    if (!currencyPairEquals(this.pair, other.pair)) return false;
    if (!this.capturedAt.equals(other.capturedAt)) return false;
    for (const tf of LIVE_TIMEFRAMES) {
      if (!this.timeFrames.get(tf)!.equals(other.timeFrames.get(tf)!)) return false;
    }
    return true;
  }
}
