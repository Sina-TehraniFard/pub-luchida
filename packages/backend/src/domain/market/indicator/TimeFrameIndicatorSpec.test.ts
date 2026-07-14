import { describe, it, expect } from 'vitest';
import { timeFrameIndicatorSpecOf } from './TimeFrameIndicatorSpec.js';
import { TimeFrame } from '../TimeFrame.js';

describe('TimeFrameIndicatorSpec', () => {
  it('正常な期間で生成できる', () => {
    const spec = timeFrameIndicatorSpecOf({
      timeFrame: TimeFrame.FIFTEEN_MINUTE, shortPeriod: 20, longPeriod: 100,
    });
    expect(spec.timeFrame).toBe(TimeFrame.FIFTEEN_MINUTE);
    expect(spec.shortPeriod).toBe(20);
    expect(spec.longPeriod).toBe(100);
  });

  it('shortPeriod が 0 以下だとエラー', () => {
    expect(() => timeFrameIndicatorSpecOf({
      timeFrame: TimeFrame.ONE_HOUR, shortPeriod: 0, longPeriod: 100,
    })).toThrow(/shortPeriod/);
  });

  it('shortPeriod が負だとエラー', () => {
    expect(() => timeFrameIndicatorSpecOf({
      timeFrame: TimeFrame.ONE_HOUR, shortPeriod: -1, longPeriod: 100,
    })).toThrow(/shortPeriod/);
  });

  it('longPeriod が 0 以下だとエラー', () => {
    expect(() => timeFrameIndicatorSpecOf({
      timeFrame: TimeFrame.ONE_HOUR, shortPeriod: 20, longPeriod: 0,
    })).toThrow(/longPeriod/);
  });

  it('shortPeriod が longPeriod 以上だとエラー', () => {
    expect(() => timeFrameIndicatorSpecOf({
      timeFrame: TimeFrame.ONE_HOUR, shortPeriod: 100, longPeriod: 100,
    })).toThrow(/short.*long/);
  });

  it('shortPeriod が longPeriod を超えるとエラー', () => {
    expect(() => timeFrameIndicatorSpecOf({
      timeFrame: TimeFrame.ONE_HOUR, shortPeriod: 200, longPeriod: 100,
    })).toThrow(/short.*long/);
  });

  it('整数でないとエラー', () => {
    expect(() => timeFrameIndicatorSpecOf({
      timeFrame: TimeFrame.ONE_HOUR, shortPeriod: 20.5, longPeriod: 100,
    })).toThrow(/shortPeriod/);
  });
});
