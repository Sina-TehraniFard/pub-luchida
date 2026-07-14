import { describe, it, expect } from 'vitest';
import { SmaValue } from './SmaValue.js';

describe('SmaValue', () => {
  describe('生成', () => {
    it('正の数値文字列を渡すと、SmaValue が生成される', () => {
      // Given: 有効な SMA 値（短期 SMA の典型的な値）
      const value = '150.250';

      // When: SmaValue.of() で生成する
      const sma = SmaValue.of(value);

      // Then: 同じ値が文字列で取り出せる
      expect(sma.toString()).toBe('150.25');
    });

    it('ゼロを渡すとエラーが投げられる（SMA はゼロにならない）', () => {
      // Given: ゼロ（SMA として無効）
      // When / Then: 正の数でないためエラー
      expect(() => SmaValue.of('0')).toThrow('SMA は正の数');
    });

    it('負の数を渡すとエラーが投げられる', () => {
      // Given: 負の値（SMA として無効）
      // When / Then: 正の数でないためエラー
      expect(() => SmaValue.of('-100')).toThrow('SMA は正の数');
    });
  });

  describe('isAbove（上位判定）', () => {
    it('この SMA が other より上のとき true', () => {
      // Given: this が other を上回っている状態
      const shortSma = SmaValue.of('151.000');
      const longSma = SmaValue.of('150.000');

      // When: isAbove() で比較する
      const result = shortSma.isAbove(longSma);

      // Then: 上にいるので true
      expect(result).toBe(true);
    });

    it('この SMA が other より下のとき false', () => {
      // Given: this が other を下回っている状態
      const shortSma = SmaValue.of('149.000');
      const longSma = SmaValue.of('150.000');

      // When: isAbove() で比較する
      const result = shortSma.isAbove(longSma);

      // Then: 上にいないので false
      expect(result).toBe(false);
    });

    it('同じ値のとき false', () => {
      // Given: this と other が同値
      const shortSma = SmaValue.of('150.000');
      const longSma = SmaValue.of('150.000');

      // When: isAbove() で比較する
      const result = shortSma.isAbove(longSma);

      // Then: 等値なので上にいない → false
      expect(result).toBe(false);
    });
  });

  describe('isBelow（下位判定）', () => {
    it('この SMA が other より下のとき true', () => {
      // Given: this が other を下回っている状態
      const shortSma = SmaValue.of('149.000');
      const longSma = SmaValue.of('150.000');

      // When: isBelow() で比較する
      const result = shortSma.isBelow(longSma);

      // Then: 下にいるので true
      expect(result).toBe(true);
    });

    it('同じ値のとき false', () => {
      // Given: this と other が同値
      const shortSma = SmaValue.of('150.000');
      const longSma = SmaValue.of('150.000');

      // When: isBelow() で比較する
      const result = shortSma.isBelow(longSma);

      // Then: 等値なので下にいない → false
      expect(result).toBe(false);
    });
  });

  describe('等価比較', () => {
    it('同じ値の SmaValue どうしは等価と判定される', () => {
      // Given: 同じ SMA 値を表す 2 つの SmaValue（末尾ゼロの違いあり）
      const a = SmaValue.of('150.500');
      const b = SmaValue.of('150.5');

      // When: equals() で比較する
      // Then: 末尾ゼロの有無によらず等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる値の SmaValue どうしは非等価と判定される', () => {
      // Given: わずかに異なる 2 つの SMA 値
      const a = SmaValue.of('150.5');
      const b = SmaValue.of('150.6');

      // When: equals() で比較する
      // Then: 値が違うので非等価
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString', () => {
    it('toString() は文字列を返す', () => {
      // Given: 任意の SmaValue
      const sma = SmaValue.of('150.123');

      // When: toString() を呼ぶ
      const result = sma.toString();

      // Then: 文字列型で値が返る
      expect(typeof result).toBe('string');
      expect(result).toBe('150.123');
    });
  });
});
