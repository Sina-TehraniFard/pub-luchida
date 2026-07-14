import type { TimeFrame } from '../TimeFrame.js';

/**
 * ある TimeFrame に対する SMA の期間設定。
 *
 * 「この時間足では shortPeriod 本と longPeriod 本の SMA を計算する」
 * というドメインの取り決めを表す値オブジェクト。
 *
 * 不変条件:
 * - shortPeriod, longPeriod は正の整数
 * - shortPeriod < longPeriod（短期と長期の関係を逆転しない）
 *
 * 値オブジェクトのため readonly。生成は timeFrameIndicatorSpecOf() を使う。
 */
export interface TimeFrameIndicatorSpec {
  readonly timeFrame: TimeFrame;
  readonly shortPeriod: number;
  readonly longPeriod: number;
}

export function timeFrameIndicatorSpecOf(params: {
  timeFrame: TimeFrame;
  shortPeriod: number;
  longPeriod: number;
}): TimeFrameIndicatorSpec {
  if (!Number.isInteger(params.shortPeriod) || params.shortPeriod <= 0) {
    throw new Error(`shortPeriod は正の整数: ${params.shortPeriod}`);
  }
  if (!Number.isInteger(params.longPeriod) || params.longPeriod <= 0) {
    throw new Error(`longPeriod は正の整数: ${params.longPeriod}`);
  }
  if (params.shortPeriod >= params.longPeriod) {
    throw new Error(
      `shortPeriod は longPeriod より小さい必要があります: short=${params.shortPeriod} long=${params.longPeriod}`,
    );
  }
  return {
    timeFrame: params.timeFrame,
    shortPeriod: params.shortPeriod,
    longPeriod: params.longPeriod,
  };
}
