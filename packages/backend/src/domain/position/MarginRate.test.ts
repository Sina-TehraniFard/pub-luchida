import { describe, it, expect } from 'vitest';
import Big from 'big.js';
import { MarginRate } from './MarginRate.js';

describe('MarginRate', () => {
  describe('of()', () => {
    it('0.04（GMO FX 国内ユーザーのレバレッジ 25 倍相当）で生成できる', () => {
      // Given: GMO FX 国内ユーザーの証拠金率
      const rate = MarginRate.of(0.04);

      // When / Then: 0.04 で保持される
      expect(rate.toNumber()).toBe(0.04);
    });

    it('0.5 を渡すと、0.5 の MarginRate が生成される', () => {
      // Given: 中間値
      const rate = MarginRate.of(0.5);

      // When / Then: 0.5 で保持される
      expect(rate.toNumber()).toBe(0.5);
    });

    it('文字列 "0.04" でも生成できる', () => {
      // Given: 文字列入力
      const rate = MarginRate.of('0.04');

      // When / Then: 数値と同じ扱い
      expect(rate.toNumber()).toBe(0.04);
    });

    it('0 を渡すと、エラーが投げられる', () => {
      // Given: 範囲外（下限）
      // When / Then: (0, 1) の範囲外
      expect(() => MarginRate.of(0)).toThrow('MarginRate は 0 超 1 未満');
    });

    it('1 を渡すと、エラーが投げられる', () => {
      // Given: 範囲外（上限）
      // When / Then: (0, 1) の範囲外
      expect(() => MarginRate.of(1)).toThrow('MarginRate は 0 超 1 未満');
    });

    it('負の値を渡すと、エラーが投げられる', () => {
      // Given: 範囲外（負）
      // When / Then: (0, 1) の範囲外
      expect(() => MarginRate.of(-0.04)).toThrow('MarginRate は 0 超 1 未満');
    });

    it('1 を超える値を渡すと、エラーが投げられる', () => {
      // Given: 範囲外（上限超過）
      // When / Then: (0, 1) の範囲外
      expect(() => MarginRate.of(1.5)).toThrow('MarginRate は 0 超 1 未満');
    });
  });

  describe('toNumber()', () => {
    it('内部の値を number として取得できる', () => {
      // Given: 0.04 の MarginRate
      const rate = MarginRate.of(0.04);

      // When: toNumber() で取得
      const n = rate.toNumber();

      // Then: 0.04
      expect(n).toBe(0.04);
    });
  });

  describe('toBig()', () => {
    it('内部の Big 値を取得できる', () => {
      // Given: 0.04 の MarginRate
      const rate = MarginRate.of(0.04);

      // When: toBig() で内部の Big を取得
      const big = rate.toBig();

      // Then: Big のインスタンスで、値が一致する
      expect(big).toBeInstanceOf(Big);
      expect(big.eq(new Big('0.04'))).toBe(true);
    });
  });

  describe('leverageEquivalent()', () => {
    it('0.04 のレバレッジ換算値は 25 になる', () => {
      // Given: GMO FX 国内ユーザーの証拠金率
      const rate = MarginRate.of(0.04);

      // When: レバレッジ換算
      const leverage = rate.leverageEquivalent();

      // Then: 1 / 0.04 = 25
      expect(leverage).toBe(25);
    });

    it('0.5 のレバレッジ換算値は 2 になる', () => {
      // Given: 0.5 の証拠金率
      const rate = MarginRate.of(0.5);

      // When: レバレッジ換算
      const leverage = rate.leverageEquivalent();

      // Then: 1 / 0.5 = 2
      expect(leverage).toBe(2);
    });
  });

  describe('equals()', () => {
    it('同じ値の MarginRate どうしは等価と判定される', () => {
      // Given: 同じ 0.04 を 2 つ
      const a = MarginRate.of(0.04);
      const b = MarginRate.of(0.04);

      // When / Then: 等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる値の MarginRate どうしは非等価と判定される', () => {
      // Given: 0.04 と 0.5
      const a = MarginRate.of(0.04);
      const b = MarginRate.of(0.5);

      // When / Then: 非等価
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('小数を含む値は Big.toFixed() のフォーマットで表示される', () => {
      // Given: 0.04
      const rate = MarginRate.of(0.04);

      // When / Then: Big('0.04').toFixed() は '0.04'
      expect(rate.toString()).toBe('0.04');
    });

    it('文字列で渡した精度は Big の正規化に従う', () => {
      // Given: 文字列 '0.0400'
      const rate = MarginRate.of('0.0400');

      // When / Then: Big の正規化で末尾ゼロは除去される
      expect(rate.toString()).toBe('0.04');
    });

    it('中間値（0.5）も toFixed() の表記で表示される', () => {
      // Given: 0.5
      const rate = MarginRate.of(0.5);

      // When / Then
      expect(rate.toString()).toBe('0.5');
    });
  });
});
