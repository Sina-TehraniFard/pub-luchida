import { describe, it, expect } from 'vitest';
import { TickTimestamp } from './TickTimestamp.js';

describe('TickTimestamp', () => {
  describe('生成', () => {
    it('Date を渡すと TickTimestamp が生成される', () => {
      // Given: 任意の Date オブジェクト
      const date = new Date('2024-01-15T10:30:00.123Z');

      // When: TickTimestamp.of() で生成する
      const ts = TickTimestamp.of(date);

      // Then: 生成されたインスタンスが存在する
      expect(ts).toBeInstanceOf(TickTimestamp);
    });

    it('無効な Date を渡すとエラーが投げられる', () => {
      // Given: 無効な Date オブジェクト
      const invalidDate = new Date('invalid');

      // When: TickTimestamp.of() に渡す
      // Then: エラーが投げられる
      expect(() => TickTimestamp.of(invalidDate)).toThrow('TickTimestamp: 無効な日時から生成できません');
    });

    it('null を渡すとエラーが投げられる', () => {
      // Given: null
      // When: TickTimestamp.of() に渡す
      // Then: エラーが投げられる
      expect(() => TickTimestamp.of(null as unknown as Date)).toThrow('TickTimestamp: 無効な日時から生成できません');
    });

    it('of() に渡した Date を後から変更しても TickTimestamp は影響を受けない', () => {
      // Given: 変更可能な Date オブジェクトから TickTimestamp を生成する
      const mutable = new Date('2024-01-15T10:30:00.000Z');
      const ts = TickTimestamp.of(mutable);
      const originalString = ts.toString();

      // When: 元の Date を別の年に書き換える
      mutable.setFullYear(2099);

      // Then: TickTimestamp の内部値は変化していない
      expect(ts.toString()).toBe(originalString);
    });
  });

  describe('toDate()', () => {
    it('toDate() は元の Date と同じ時刻を返す', () => {
      // Given: 特定の時刻を持つ TickTimestamp
      const date = new Date('2024-01-15T10:30:00.123Z');
      const ts = TickTimestamp.of(date);

      // When: toDate() で Date を取り出す
      const result = ts.toDate();

      // Then: 元の Date と同じミリ秒値を持つ
      expect(result.getTime()).toBe(date.getTime());
    });

    it('toDate() が返す Date を変更しても、元の TickTimestamp は影響を受けない', () => {
      // Given: TickTimestamp を生成し、toDate() でコピーを取り出す
      const date = new Date('2024-01-15T10:30:00.000Z');
      const ts = TickTimestamp.of(date);
      const originalTime = ts.toDate().getTime();

      // When: 取り出した Date を別の時刻に書き換える
      const copy = ts.toDate();
      copy.setFullYear(2099);

      // Then: TickTimestamp の内部値は変化していない
      expect(ts.toDate().getTime()).toBe(originalTime);
    });
  });

  describe('等価比較', () => {
    it('同じ時刻の TickTimestamp どうしは等価と判定される', () => {
      // Given: 同じ時刻から生成した 2つの TickTimestamp
      const date = new Date('2024-01-15T10:30:00.123Z');
      const a = TickTimestamp.of(date);
      const b = TickTimestamp.of(date);

      // When: equals() で比較する
      // Then: 等価と判定される
      expect(a.equals(b)).toBe(true);
    });

    it('異なる時刻の TickTimestamp どうしは非等価と判定される', () => {
      // Given: 1ミリ秒異なる 2つの TickTimestamp
      const a = TickTimestamp.of(new Date('2024-01-15T10:30:00.000Z'));
      const b = TickTimestamp.of(new Date('2024-01-15T10:30:00.001Z'));

      // When: equals() で比較する
      // Then: 非等価と判定される
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('isBefore()', () => {
    it('古い tick の時刻は新しい tick の時刻より前と判定される', () => {
      // Given: 時刻が異なる 2つの TickTimestamp
      const older = TickTimestamp.of(new Date('2024-01-15T10:30:00.000Z'));
      const newer = TickTimestamp.of(new Date('2024-01-15T10:30:00.001Z'));

      // When: isBefore() で比較する
      // Then: 古い方が前と判定される
      expect(older.isBefore(newer)).toBe(true);
    });

    it('同じ時刻の場合は false を返す', () => {
      // Given: 同じ時刻から生成した 2つの TickTimestamp
      const date = new Date('2024-01-15T10:30:00.000Z');
      const a = TickTimestamp.of(date);
      const b = TickTimestamp.of(date);

      // When: isBefore() で比較する
      // Then: false を返す
      expect(a.isBefore(b)).toBe(false);
    });

    it('新しい時刻は古い時刻より前ではないと判定される', () => {
      // Given: 時刻が異なる 2つの TickTimestamp
      const older = TickTimestamp.of(new Date('2024-01-15T10:30:00.000Z'));
      const newer = TickTimestamp.of(new Date('2024-01-15T10:30:00.001Z'));

      // When: isBefore() で比較する
      // Then: 新しい時刻は前ではないので false を返す
      expect(newer.isBefore(older)).toBe(false);
    });
  });

  describe('isAfter()', () => {
    it('新しい tick の時刻は古い tick の時刻より後と判定される', () => {
      // Given: 時刻が異なる 2つの TickTimestamp
      const older = TickTimestamp.of(new Date('2024-01-15T10:30:00.000Z'));
      const newer = TickTimestamp.of(new Date('2024-01-15T10:30:00.001Z'));

      // When: isAfter() で比較する
      // Then: 新しい方が後と判定される
      expect(newer.isAfter(older)).toBe(true);
    });

    it('同じ時刻の場合は false を返す', () => {
      // Given: 同じ時刻から生成した 2つの TickTimestamp
      const date = new Date('2024-01-15T10:30:00.000Z');
      const a = TickTimestamp.of(date);
      const b = TickTimestamp.of(date);

      // When: isAfter() で比較する
      // Then: false を返す
      expect(a.isAfter(b)).toBe(false);
    });

    it('古い時刻は新しい時刻より後ではないと判定される', () => {
      // Given: 時刻が異なる 2つの TickTimestamp
      const older = TickTimestamp.of(new Date('2024-01-15T10:30:00.000Z'));
      const newer = TickTimestamp.of(new Date('2024-01-15T10:30:00.001Z'));

      // When: isAfter() で比較する
      // Then: 古い時刻は後ではないので false を返す
      expect(older.isAfter(newer)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('toString() は ISO 8601 形式の文字列を返す', () => {
      // Given: 特定の時刻を持つ TickTimestamp
      const isoString = '2024-01-15T10:30:00.123Z';
      const ts = TickTimestamp.of(new Date(isoString));

      // When: toString() で文字列化する
      const result = ts.toString();

      // Then: ISO 8601 形式の文字列が返る
      expect(result).toBe(isoString);
    });
  });
});
