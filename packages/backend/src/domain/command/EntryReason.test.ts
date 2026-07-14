import { describe, it, expect } from 'vitest';
import { EntryReason } from './EntryReason.js';

describe('EntryReason', () => {
  describe('生成（正常系）', () => {
    it('有効な文字列で EntryReason が生成される', () => {
      // Given: 有効な理由文字列
      const value = 'SMA ゴールデンクロス発生';

      // When: EntryReason.of() で生成する
      const reason = EntryReason.of(value);

      // Then: インスタンスが返る
      expect(reason).toBeInstanceOf(EntryReason);
    });

    it('前後に空白がある文字列でも生成される', () => {
      // Given: 前後にスペースがある理由文字列（空白のみではない）

      // When
      const reason = EntryReason.of('  SMA クロス  ');

      // Then: インスタンスが返る
      expect(reason).toBeInstanceOf(EntryReason);
    });
  });

  describe('生成（異常系）', () => {
    it('空文字列のときエラーが投げられる', () => {
      // When / Then
      expect(() => EntryReason.of('')).toThrow('EntryReason は空文字列にできません');
    });

    it('空白のみのときエラーが投げられる', () => {
      // When / Then
      expect(() => EntryReason.of('   ')).toThrow('EntryReason は空文字列にできません');
    });
  });

  describe('toString()', () => {
    it('生成時に渡した文字列がそのまま返る（トリムなし）', () => {
      // Given
      const value = 'SMA ゴールデンクロス発生';

      // When
      const reason = EntryReason.of(value);

      // Then
      expect(reason.toString()).toBe(value);
    });

    it('前後に空白がある場合もトリムされずそのまま返る', () => {
      // Given
      const value = '  SMA クロス  ';

      // When
      const reason = EntryReason.of(value);

      // Then
      expect(reason.toString()).toBe(value);
    });
  });

  describe('equals()', () => {
    it('同じ値を持つ EntryReason どうしは等価と判定される', () => {
      // Given
      const a = EntryReason.of('SMA ゴールデンクロス');
      const b = EntryReason.of('SMA ゴールデンクロス');

      // When / Then
      expect(a.equals(b)).toBe(true);
    });

    it('異なる値を持つ EntryReason は非等価と判定される', () => {
      // Given
      const a = EntryReason.of('SMA ゴールデンクロス');
      const b = EntryReason.of('SMA デッドクロス');

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('自己比較は等価と判定される', () => {
      // Given
      const a = EntryReason.of('SMA ゴールデンクロス');

      // When / Then
      expect(a.equals(a)).toBe(true);
    });
  });
});
