import { describe, it, expect } from 'vitest';
import { DISPLAY_TIME_ZONE, formatInDisplayTimeZone } from './TimeZone.js';

describe('TimeZone', () => {
  it('表示用タイムゾーンは IANA 名で定義される（オフセット直書きしない）', () => {
    expect(DISPLAY_TIME_ZONE).toBe('Asia/Tokyo');
  });

  describe('formatInDisplayTimeZone', () => {
    it('UTC の Date を JST（+9h）の YYYY-MM-DD HH:mm:ss.SSS に整形する', () => {
      // Given: UTC で 2026-06-13 15:00:02.634（= JST 2026-06-14 00:00:02.634）
      const utc = new Date('2026-06-13T15:00:02.634Z');

      // When / Then
      expect(formatInDisplayTimeZone(utc)).toBe('2026-06-14 00:00:02.634');
    });

    it('日付・月をまたぐ繰り上がりを正しく扱う', () => {
      // Given: UTC 23:30 は JST 翌日 08:30
      const utc = new Date('2026-12-31T23:30:00.000Z');

      // When / Then: 年・月・日すべて繰り上がる
      expect(formatInDisplayTimeZone(utc)).toBe('2027-01-01 08:30:00.000');
    });

    it('ミリ秒を 3 桁ゼロ埋めする', () => {
      const utc = new Date('2026-06-13T15:00:00.007Z');
      expect(formatInDisplayTimeZone(utc)).toBe('2026-06-14 00:00:00.007');
    });
  });
});
