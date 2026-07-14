import { describe, it, expect } from 'vitest';
import { CandleCloseTime } from './CandleCloseTime.js';

describe('CandleCloseTime', () => {
  describe('生成', () => {
    it('無効な Date を渡すとエラーが投げられる', () => {
      // Given: パースに失敗した無効な Date
      const invalidDate = new Date('invalid');

      // When: CandleCloseTime.of() に渡す
      // Then: エラーが投げられる
      expect(() => CandleCloseTime.of(invalidDate)).toThrow(
        'CandleCloseTime: 無効な日時から生成できません',
      );
    });

    it('null を渡すとエラーが投げられる', () => {
      // Given: null
      // When: CandleCloseTime.of() に渡す
      // Then: エラーが投げられる
      expect(() => CandleCloseTime.of(null as unknown as Date)).toThrow(
        'CandleCloseTime: 無効な日時から生成できません',
      );
    });

    it('Date を渡すと CandleCloseTime が生成される', () => {
      // Given: 2024-01-01 09:00:59 UTC の Date（1分足の終了時刻）
      const date = new Date('2024-01-01T09:00:59.999Z');

      // When: CandleCloseTime.of() で生成する
      const closeTime = CandleCloseTime.of(date);

      // Then: 同じ時刻が ISO 8601 形式で取り出せる
      expect(closeTime.toString()).toBe('2024-01-01T09:00:59.999Z');
    });
  });

  describe('不変性', () => {
    it('of() に渡した Date を後から変更しても CandleCloseTime は影響を受けない', () => {
      // Given: 可変な Date を用意して CandleCloseTime を生成する
      const mutable = new Date('2024-01-01T09:00:59.999Z');
      const closeTime = CandleCloseTime.of(mutable);

      // When: 元の Date を書き換える
      mutable.setFullYear(2099);

      // Then: closeTime 自身の時刻は変わっていない
      expect(closeTime.toString()).toBe('2024-01-01T09:00:59.999Z');
    });

    it('toDate() が返す Date を変更しても元の CandleCloseTime は影響を受けない', () => {
      // Given: CandleCloseTime を生成する
      const original = new Date('2024-01-01T09:00:59.999Z');
      const closeTime = CandleCloseTime.of(original);

      // When: toDate() が返す Date を書き換える
      const returned = closeTime.toDate();
      returned.setFullYear(2099);

      // Then: closeTime 自身の時刻は変わっていない
      expect(closeTime.toString()).toBe('2024-01-01T09:00:59.999Z');
    });
  });

  describe('等価比較', () => {
    it('同じ時刻どうしは等価と判定される', () => {
      // Given: 同じ時刻を表す 2つの CandleCloseTime
      const a = CandleCloseTime.of(new Date('2024-01-01T09:00:59.999Z'));
      const b = CandleCloseTime.of(new Date('2024-01-01T09:00:59.999Z'));

      // When: equals() で比較する
      // Then: 等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる時刻どうしは非等価と判定される', () => {
      // Given: 1分異なる 2つの CandleCloseTime
      const a = CandleCloseTime.of(new Date('2024-01-01T09:00:59.999Z'));
      const b = CandleCloseTime.of(new Date('2024-01-01T09:01:59.999Z'));

      // When: equals() で比較する
      // Then: 非等価
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('前後比較', () => {
    it('新しい足の終了時刻は、古い足の終了時刻より後と判定される', () => {
      // Given: 1分足の連続する 2つの終了時刻
      const older = CandleCloseTime.of(new Date('2024-01-01T09:00:59.999Z'));
      const newer = CandleCloseTime.of(new Date('2024-01-01T09:01:59.999Z'));

      // When: isAfter() で比較する
      // Then: 新しい方が true、古い方が false
      expect(newer.isAfter(older)).toBe(true);
      expect(older.isAfter(newer)).toBe(false);
    });

    it('同じ時刻の場合は isAfter() が false を返す', () => {
      // Given: 同じ時刻を表す 2つの CandleCloseTime
      const a = CandleCloseTime.of(new Date('2024-01-01T09:00:59.999Z'));
      const b = CandleCloseTime.of(new Date('2024-01-01T09:00:59.999Z'));

      // When: isAfter() で比較する
      // Then: 同一時刻は「後」ではないので false
      expect(a.isAfter(b)).toBe(false);
    });

    it('古い足の終了時刻は、新しい足の終了時刻より前と判定される', () => {
      // Given: 1分足の連続する 2つの終了時刻
      const older = CandleCloseTime.of(new Date('2024-01-01T09:00:59.999Z'));
      const newer = CandleCloseTime.of(new Date('2024-01-01T09:01:59.999Z'));

      // When: isBefore() で比較する
      // Then: 古い方が true、新しい方が false
      expect(older.isBefore(newer)).toBe(true);
      expect(newer.isBefore(older)).toBe(false);
    });

    it('同じ時刻の場合は isBefore() が false を返す', () => {
      // Given: 同じ時刻を表す 2つの CandleCloseTime
      const a = CandleCloseTime.of(new Date('2024-01-01T09:00:59.999Z'));
      const b = CandleCloseTime.of(new Date('2024-01-01T09:00:59.999Z'));

      // When: isBefore() で比較する
      // Then: 同一時刻は「前」ではないので false
      expect(a.isBefore(b)).toBe(false);
    });
  });
});
