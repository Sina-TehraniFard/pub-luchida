import { describe, it, expect } from 'vitest';
import { Timestamp } from './Timestamp.js';

describe('Timestamp', () => {
  describe('生成', () => {
    it('Date を渡すと Timestamp が生成される', () => {
      // Given: 任意の日時を表す Date
      const date = new Date('2024-06-01T12:00:00.000Z');

      // When: Timestamp.of() で生成する
      const ts = Timestamp.of(date);

      // Then: 同じ日時が ISO 8601 形式で取り出せる
      expect(ts.toString()).toBe('2024-06-01T12:00:00.000Z');
    });

    it('無効な Date を渡すとエラーが投げられる', () => {
      // Given: 無効な日時を表す Date
      const invalidDate = new Date('invalid');

      // When: Timestamp.of() に渡す
      // Then: エラーが投げられる
      expect(() => Timestamp.of(invalidDate)).toThrow('Timestamp: 無効な日時から生成できません');
    });

    it('null を渡すとエラーが投げられる', () => {
      // Given: null
      // When: Timestamp.of() に null を渡す
      // Then: エラーが投げられる
      expect(() => Timestamp.of(null as unknown as Date)).toThrow('Timestamp: 無効な日時から生成できません');
    });

    it('of() に渡した Date を後から変更しても Timestamp は影響を受けない（入力側防御コピー）', () => {
      // Given: 変更可能な Date
      const mutable = new Date('2024-06-01T12:00:00.000Z');

      // When: Timestamp を生成した後、元の Date を書き換える
      const ts = Timestamp.of(mutable);
      mutable.setFullYear(2099);

      // Then: Timestamp 内部の時刻は元のまま
      expect(ts.toString()).toBe('2024-06-01T12:00:00.000Z');
    });

    it('now() で現在時刻の Timestamp が生成される', () => {
      // Given: now() 呼び出し前後の時刻を記録する
      const before = Date.now();

      // When: Timestamp.now() で生成する
      const ts = Timestamp.now();
      const after = Date.now();

      // Then: before <= ts <= after の範囲に収まる
      expect(ts.toDate().getTime()).toBeGreaterThanOrEqual(before);
      expect(ts.toDate().getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('不変性', () => {
    it('toDate() が返す Date を変更しても元の Timestamp は影響を受けない', () => {
      // Given: ある時刻の Timestamp
      const original = new Date('2024-06-01T12:00:00.000Z');
      const ts = Timestamp.of(original);

      // When: toDate() で取り出した Date を書き換える
      const returned = ts.toDate();
      returned.setFullYear(2000);

      // Then: Timestamp 内部の時刻は変わっていない
      expect(ts.toString()).toBe('2024-06-01T12:00:00.000Z');
    });
  });

  describe('等価比較', () => {
    it('同じ時刻どうしは等価と判定される', () => {
      // Given: 同じ日時を表す 2つの Timestamp
      const a = Timestamp.of(new Date('2024-06-01T12:00:00.000Z'));
      const b = Timestamp.of(new Date('2024-06-01T12:00:00.000Z'));

      // When: equals() で比較する
      // Then: 等価と判定される
      expect(a.equals(b)).toBe(true);
    });

    it('異なる時刻どうしは非等価と判定される', () => {
      // Given: 1秒異なる 2つの Timestamp
      const a = Timestamp.of(new Date('2024-06-01T12:00:00.000Z'));
      const b = Timestamp.of(new Date('2024-06-01T12:00:01.000Z'));

      // When: equals() で比較する
      // Then: 非等価と判定される
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('前後比較', () => {
    it('isBefore() — 古い時刻は新しい時刻より前と判定される', () => {
      // Given: 古い時刻と新しい時刻
      const older = Timestamp.of(new Date('2024-06-01T12:00:00.000Z'));
      const newer = Timestamp.of(new Date('2024-06-01T13:00:00.000Z'));

      // When: isBefore() で比較する
      // Then: 古い方が前、新しい方は前ではない
      expect(older.isBefore(newer)).toBe(true);
      expect(newer.isBefore(older)).toBe(false);
    });

    it('isAfter() — 新しい時刻は古い時刻より後と判定される', () => {
      // Given: 古い時刻と新しい時刻
      const older = Timestamp.of(new Date('2024-06-01T12:00:00.000Z'));
      const newer = Timestamp.of(new Date('2024-06-01T13:00:00.000Z'));

      // When: isAfter() で比較する
      // Then: 新しい方が後、古い方は後ではない
      expect(newer.isAfter(older)).toBe(true);
      expect(older.isAfter(newer)).toBe(false);
    });

    it('isBefore() — 同じ時刻どうしは false を返す', () => {
      // Given: 同じ時刻を表す 2つの Timestamp
      const a = Timestamp.of(new Date('2024-06-01T12:00:00.000Z'));
      const b = Timestamp.of(new Date('2024-06-01T12:00:00.000Z'));

      // When: isBefore() で比較する
      // Then: false が返る
      expect(a.isBefore(b)).toBe(false);
    });

    it('isAfter() — 同じ時刻どうしは false を返す', () => {
      // Given: 同じ時刻を表す 2つの Timestamp
      const a = Timestamp.of(new Date('2024-06-01T12:00:00.000Z'));
      const b = Timestamp.of(new Date('2024-06-01T12:00:00.000Z'));

      // When: isAfter() で比較する
      // Then: false が返る
      expect(a.isAfter(b)).toBe(false);
    });
  });
});
