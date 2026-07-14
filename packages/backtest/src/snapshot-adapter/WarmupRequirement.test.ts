import { describe, it, expect } from 'vitest';
import { WarmupRequirement } from './WarmupRequirement.js';
import { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import { timeFrameIndicatorSpecOf } from '@luchida/backend/domain/market/indicator/TimeFrameIndicatorSpec.js';

describe('WarmupRequirement', () => {
  it('空配列で生成するとエラー', () => {
    expect(() => WarmupRequirement.forSpecs([])).toThrow(/1 つ以上/);
  });

  it('timeFrame 重複でエラー', () => {
    expect(() => WarmupRequirement.forSpecs([
      timeFrameIndicatorSpecOf({ timeFrame: TimeFrame.FIFTEEN_MINUTE, shortPeriod: 20, longPeriod: 100 }),
      timeFrameIndicatorSpecOf({ timeFrame: TimeFrame.FIFTEEN_MINUTE, shortPeriod: 25, longPeriod: 75 }),
    ])).toThrow(/重複/);
  });

  it('warmupCountFor は longPeriod を返す', () => {
    const w = WarmupRequirement.forSpecs([
      timeFrameIndicatorSpecOf({ timeFrame: TimeFrame.FIFTEEN_MINUTE, shortPeriod: 20, longPeriod: 100 }),
      timeFrameIndicatorSpecOf({ timeFrame: TimeFrame.ONE_HOUR, shortPeriod: 50, longPeriod: 200 }),
    ]);
    expect(w.warmupCountFor(TimeFrame.FIFTEEN_MINUTE)).toBe(100);
    expect(w.warmupCountFor(TimeFrame.ONE_HOUR)).toBe(200);
  });

  it('未登録 timeframe で warmupCountFor を呼ぶとエラー', () => {
    const w = WarmupRequirement.forSpecs([
      timeFrameIndicatorSpecOf({ timeFrame: TimeFrame.FIFTEEN_MINUTE, shortPeriod: 20, longPeriod: 100 }),
    ]);
    expect(() => w.warmupCountFor(TimeFrame.ONE_DAY)).toThrow(/含まれていない/);
  });

  it('earliestStartTime は最も多く遡る timeframe に合わせる', () => {
    // 15分 × 100本 = 25h、1h × 100本 = 100h → 1h 側に合わせる
    const w = WarmupRequirement.forSpecs([
      timeFrameIndicatorSpecOf({ timeFrame: TimeFrame.FIFTEEN_MINUTE, shortPeriod: 20, longPeriod: 100 }),
      timeFrameIndicatorSpecOf({ timeFrame: TimeFrame.ONE_HOUR, shortPeriod: 20, longPeriod: 100 }),
    ]);
    const dateFrom = new Date('2026-01-05T00:00:00Z');
    const expected = new Date(dateFrom.getTime() - 100 * 3_600_000); // 100h 前
    expect(w.earliestStartTime(dateFrom).getTime()).toBe(expected.getTime());
  });

  it('earliestStartTime は単一 timeframe でも正しく動く', () => {
    const w = WarmupRequirement.forSpecs([
      timeFrameIndicatorSpecOf({ timeFrame: TimeFrame.FIFTEEN_MINUTE, shortPeriod: 20, longPeriod: 100 }),
    ]);
    const dateFrom = new Date('2026-01-05T00:00:00Z');
    const expected = new Date(dateFrom.getTime() - 100 * 900_000); // 100 × 15min = 25h 前
    expect(w.earliestStartTime(dateFrom).getTime()).toBe(expected.getTime());
  });

  it('日足 longPeriod=200 が最大なら 200 日前まで遡る', () => {
    const w = WarmupRequirement.forSpecs([
      timeFrameIndicatorSpecOf({ timeFrame: TimeFrame.FIFTEEN_MINUTE, shortPeriod: 20, longPeriod: 100 }),
      timeFrameIndicatorSpecOf({ timeFrame: TimeFrame.ONE_HOUR, shortPeriod: 20, longPeriod: 100 }),
      timeFrameIndicatorSpecOf({ timeFrame: TimeFrame.ONE_DAY, shortPeriod: 50, longPeriod: 200 }),
    ]);
    const dateFrom = new Date('2026-06-01T00:00:00Z');
    const expected = new Date(dateFrom.getTime() - 200 * 86_400_000); // 200 日前
    expect(w.earliestStartTime(dateFrom).getTime()).toBe(expected.getTime());
  });
});
