import { describe, it, expect } from 'vitest';
import { TimeFrame, durationMs, LIVE_TIMEFRAMES, isAlignedToTimeFrame } from './TimeFrame.js';

describe('TimeFrame', () => {
  describe('durationMs()', () => {
    it('ONE_MINUTE は 60000 ミリ秒を返す', () => {
      // Given: 1分足の時間足
      const timeFrame = TimeFrame.ONE_MINUTE;

      // When: ミリ秒数を取得する
      const result = durationMs(timeFrame);

      // Then: 60000 ミリ秒が返る
      expect(result).toBe(60_000);
    });

    it('ONE_HOUR は 3600000 ミリ秒を返す', () => {
      // Given: 1時間足の時間足
      const timeFrame = TimeFrame.ONE_HOUR;

      // When: ミリ秒数を取得する
      const result = durationMs(timeFrame);

      // Then: 3600000 ミリ秒が返る
      expect(result).toBe(3_600_000);
    });

    it('ONE_DAY は 86400000 ミリ秒を返す', () => {
      // Given: 日足の時間足
      const timeFrame = TimeFrame.ONE_DAY;

      // When: ミリ秒数を取得する
      const result = durationMs(timeFrame);

      // Then: 86400000 ミリ秒が返る
      expect(result).toBe(86_400_000);
    });

    it('ONE_HOUR のミリ秒数は ONE_MINUTE の 60 倍である', () => {
      // Given: 1分足と1時間足
      const oneMinute = durationMs(TimeFrame.ONE_MINUTE);
      const oneHour = durationMs(TimeFrame.ONE_HOUR);

      // When: 倍率を計算する
      const ratio = oneHour / oneMinute;

      // Then: 60 倍になる
      expect(ratio).toBe(60);
    });

    it('ONE_DAY のミリ秒数は ONE_HOUR の 24 倍である', () => {
      // Given: 1時間足と日足
      const oneHour = durationMs(TimeFrame.ONE_HOUR);
      const oneDay = durationMs(TimeFrame.ONE_DAY);

      // When: 倍率を計算する
      const ratio = oneDay / oneHour;

      // Then: 24 倍になる
      expect(ratio).toBe(24);
    });
  });

  describe('isAlignedToTimeFrame()', () => {
    it('UTC 11:00:00 は ONE_HOUR に整列している', () => {
      expect(isAlignedToTimeFrame(new Date('2026-01-01T11:00:00Z'), TimeFrame.ONE_HOUR)).toBe(true);
    });

    it('UTC 11:15:00 は ONE_HOUR に整列していない', () => {
      expect(isAlignedToTimeFrame(new Date('2026-01-01T11:15:00Z'), TimeFrame.ONE_HOUR)).toBe(false);
    });

    it('UTC 11:30:00 は FIFTEEN_MINUTE に整列している', () => {
      expect(isAlignedToTimeFrame(new Date('2026-01-01T11:30:00Z'), TimeFrame.FIFTEEN_MINUTE)).toBe(true);
    });

    it('UTC 11:31:00 は FIFTEEN_MINUTE に整列していない', () => {
      expect(isAlignedToTimeFrame(new Date('2026-01-01T11:31:00Z'), TimeFrame.FIFTEEN_MINUTE)).toBe(false);
    });

    it('UTC 00:00:00 は ONE_DAY に整列している', () => {
      expect(isAlignedToTimeFrame(new Date('2026-01-01T00:00:00Z'), TimeFrame.ONE_DAY)).toBe(true);
    });

    it('UTC 12:00:00 は ONE_DAY に整列していない', () => {
      expect(isAlignedToTimeFrame(new Date('2026-01-01T12:00:00Z'), TimeFrame.ONE_DAY)).toBe(false);
    });
  });

  describe('LIVE_TIMEFRAMES', () => {
    it('全4種類の時間足（ONE_MINUTE / FIFTEEN_MINUTE / ONE_HOUR / ONE_DAY）を含む', () => {
      // Given: 全時間足の配列
      const timeFrames = LIVE_TIMEFRAMES;

      // When: 各時間足が含まれているか確認する
      // Then: 全4種類が含まれ、要素数も4である
      expect(timeFrames).toHaveLength(4);
      expect(timeFrames).toContain(TimeFrame.ONE_MINUTE);
      expect(timeFrames).toContain(TimeFrame.FIFTEEN_MINUTE);
      expect(timeFrames).toContain(TimeFrame.ONE_HOUR);
      expect(timeFrames).toContain(TimeFrame.ONE_DAY);
    });
  });
});
