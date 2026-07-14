export const TimeFrame = {
  ONE_MINUTE: 'ONE_MINUTE',
  FIFTEEN_MINUTE: 'FIFTEEN_MINUTE',
  ONE_HOUR: 'ONE_HOUR',
  ONE_DAY: 'ONE_DAY',
} as const;

export type TimeFrame = (typeof TimeFrame)[keyof typeof TimeFrame];

export function durationMs(timeFrame: TimeFrame): number {
  switch (timeFrame) {
    case TimeFrame.ONE_MINUTE:
      return 60_000;
    case TimeFrame.FIFTEEN_MINUTE:
      return 900_000;
    case TimeFrame.ONE_HOUR:
      return 3_600_000;
    case TimeFrame.ONE_DAY:
      return 86_400_000;
  }
}

export function label(timeFrame: TimeFrame): string {
  switch (timeFrame) {
    case TimeFrame.ONE_MINUTE:
      return '1分足';
    case TimeFrame.FIFTEEN_MINUTE:
      return '15分足';
    case TimeFrame.ONE_HOUR:
      return '1時間足';
    case TimeFrame.ONE_DAY:
      return '日足';
  }
}

/**
 * ライブ運用で必須となる TimeFrame 固定4種。
 * MarketSnapshot.of() のバリデーションはこの集合で行う。
 *
 * TimeFrame enum を BT 用に拡張（例: SEVEN_MINUTE）してもこの配列は変わらないため、
 * ライブ運用には影響しない。BT 側は BT 対象の TimeFrame だけ含んだ Map で
 * MarketSnapshot を作る。
 */
export const LIVE_TIMEFRAMES: readonly TimeFrame[] = [
  TimeFrame.ONE_MINUTE,
  TimeFrame.FIFTEEN_MINUTE,
  TimeFrame.ONE_HOUR,
  TimeFrame.ONE_DAY,
] as const;

/**
 * 指定時刻が timeFrame の境界に整列しているか。
 *
 * 例: time = UTC 11:00:00, timeFrame = ONE_HOUR → true
 *     time = UTC 11:15:00, timeFrame = ONE_HOUR → false
 *
 * 用途: 下位足の openTime（または closeTime）が上位足の境界にあるかを判定し、
 * 上位足の確定タイミングを検出する（multi-timeframe 集計）。
 */
export function isAlignedToTimeFrame(time: Date, timeFrame: TimeFrame): boolean {
  return time.getTime() % durationMs(timeFrame) === 0;
}
