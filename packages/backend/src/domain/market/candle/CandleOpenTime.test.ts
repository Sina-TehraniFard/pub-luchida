import { describe, it, expect } from 'vitest';
import { CandleOpenTime } from './CandleOpenTime.js';

describe('CandleOpenTime', () => {
  describe('生成', () => {
    it('Date を渡すと CandleOpenTime が生成される', () => {
      // Given: 2024-01-01 09:00:00 UTC の Date
      const date = new Date('2024-01-01T09:00:00.000Z');

      // When: CandleOpenTime.of() で生成する
      const openTime = CandleOpenTime.of(date);

      // Then: 同じ時刻が ISO 8601 形式で取り出せる
      expect(openTime.toString()).toBe('2024-01-01T09:00:00.000Z');
    });
  });

  describe('不変性', () => {
    it('toDate() が返す Date を変更しても元の CandleOpenTime は影響を受けない', () => {
      // Given: CandleOpenTime を生成する
      const original = new Date('2024-01-01T09:00:00.000Z');
      const openTime = CandleOpenTime.of(original);

      // When: toDate() が返す Date を書き換える
      const returned = openTime.toDate();
      returned.setFullYear(2099);

      // Then: openTime 自身の時刻は変わっていない
      expect(openTime.toString()).toBe('2024-01-01T09:00:00.000Z');
    });

    it('of() に渡した Date を後から変更しても CandleOpenTime は影響を受けない', () => {
      // Given: 変更可能な Date から CandleOpenTime を生成する
      const mutable = new Date('2024-01-01T09:00:00.000Z');
      const openTime = CandleOpenTime.of(mutable);

      // When: 元の Date を書き換える
      mutable.setFullYear(2099);

      // Then: openTime の時刻は元のまま変わっていない
      expect(openTime.toString()).toBe('2024-01-01T09:00:00.000Z');
    });
  });

  describe('等価比較', () => {
    it('同じ時刻どうしは等価と判定される', () => {
      // Given: 同じ時刻を表す 2つの CandleOpenTime
      const a = CandleOpenTime.of(new Date('2024-01-01T09:00:00.000Z'));
      const b = CandleOpenTime.of(new Date('2024-01-01T09:00:00.000Z'));

      // When: equals() で比較する
      // Then: 等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる時刻どうしは非等価と判定される', () => {
      // Given: 1分異なる 2つの CandleOpenTime
      const a = CandleOpenTime.of(new Date('2024-01-01T09:00:00.000Z'));
      const b = CandleOpenTime.of(new Date('2024-01-01T09:01:00.000Z'));

      // When: equals() で比較する
      // Then: 非等価
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('生成バリデーション', () => {
    it('無効な Date を渡すとエラーが投げられる', () => {
      // Given: 無効な Date
      const invalid = new Date('invalid');

      // When: CandleOpenTime.of() に渡す
      // Then: エラーが投げられる
      expect(() => CandleOpenTime.of(invalid)).toThrow(
        'CandleOpenTime: 無効な日時から生成できません',
      );
    });

    it('null を渡すとエラーが投げられる', () => {
      // Given: null
      // When: CandleOpenTime.of() に渡す
      // Then: エラーが投げられる
      expect(() => CandleOpenTime.of(null as unknown as Date)).toThrow(
        'CandleOpenTime: 無効な日時から生成できません',
      );
    });
  });

  describe('前後比較', () => {
    it('古い足の開始時刻は、新しい足の開始時刻より前と判定される', () => {
      // Given: 1分足の連続する 2つの開始時刻
      const older = CandleOpenTime.of(new Date('2024-01-01T09:00:00.000Z'));
      const newer = CandleOpenTime.of(new Date('2024-01-01T09:01:00.000Z'));

      // When: isBefore() で比較する
      // Then: 古い方が true、新しい方が false
      expect(older.isBefore(newer)).toBe(true);
      expect(newer.isBefore(older)).toBe(false);
    });

    it('新しい足の開始時刻が古い足の開始時刻より前かどうかで false を返す', () => {
      // Given: 1分足の連続する 2つの開始時刻
      const older = CandleOpenTime.of(new Date('2024-01-01T09:00:00.000Z'));
      const newer = CandleOpenTime.of(new Date('2024-01-01T09:01:00.000Z'));

      // When: newer.isBefore(older) で比較する
      // Then: 新しい時刻は古い時刻より前ではないので false
      expect(newer.isBefore(older)).toBe(false);
    });

    it('同じ時刻の場合は isBefore() が false を返す', () => {
      // Given: 同じ時刻を表す 2つの CandleOpenTime
      const a = CandleOpenTime.of(new Date('2024-01-01T09:00:00.000Z'));
      const b = CandleOpenTime.of(new Date('2024-01-01T09:00:00.000Z'));

      // When: isBefore() で比較する
      // Then: 同一時刻は「前」ではないので false
      expect(a.isBefore(b)).toBe(false);
    });

    it('新しい足の開始時刻は、古い足の開始時刻より後と判定される', () => {
      // Given: 1分足の連続する 2つの開始時刻
      const older = CandleOpenTime.of(new Date('2024-01-01T09:00:00.000Z'));
      const newer = CandleOpenTime.of(new Date('2024-01-01T09:01:00.000Z'));

      // When: isAfter() で比較する
      // Then: 新しい方が true、古い方が false
      expect(newer.isAfter(older)).toBe(true);
      expect(older.isAfter(newer)).toBe(false);
    });

    it('古い足の開始時刻が新しい足の開始時刻より後かどうかで false を返す', () => {
      // Given: 1分足の連続する 2つの開始時刻
      const older = CandleOpenTime.of(new Date('2024-01-01T09:00:00.000Z'));
      const newer = CandleOpenTime.of(new Date('2024-01-01T09:01:00.000Z'));

      // When: older.isAfter(newer) で比較する
      // Then: 古い時刻は新しい時刻より後ではないので false
      expect(older.isAfter(newer)).toBe(false);
    });

    it('同じ時刻の場合は isAfter() が false を返す', () => {
      // Given: 同じ時刻を表す 2つの CandleOpenTime
      const a = CandleOpenTime.of(new Date('2024-01-01T09:00:00.000Z'));
      const b = CandleOpenTime.of(new Date('2024-01-01T09:00:00.000Z'));

      // When: isAfter() で比較する
      // Then: 同一時刻は「後」ではないので false
      expect(a.isAfter(b)).toBe(false);
    });
  });
});
