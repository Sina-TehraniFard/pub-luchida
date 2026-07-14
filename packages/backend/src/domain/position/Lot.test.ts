import { describe, it, expect } from 'vitest';
import { Lot } from './Lot.js';

describe('Lot', () => {
  describe('生成', () => {
    it('100の倍数かつ範囲内の整数を渡すと、その数量の Lot が生成される', () => {
      // Given: 有効な取引数量
      const value = 100;

      // When: Lot.of() で生成する
      const lot = Lot.of(value);

      // Then: 指定した数量が取り出せる
      expect(lot.toNumber()).toBe(100);
    });

    it('上限値 500,000 で生成できる', () => {
      // Given: 上限値
      const lot = Lot.of(500_000);

      // Then: 指定した数量が取り出せる
      expect(lot.toNumber()).toBe(500_000);
    });

    it('小数を渡すと、エラーが投げられる（Lot は整数単位）', () => {
      // Given: 小数（Lot は整数単位）
      // When / Then: 整数でないためエラー
      expect(() => Lot.of(150.5)).toThrow('Lotは整数');
    });

    it('100未満を渡すと、エラーが投げられる', () => {
      // Given: 100未満の数量
      // When / Then: 100以上でなければならないためエラー
      expect(() => Lot.of(99)).toThrow('Lotは100以上');
    });

    it('ゼロを渡すと、エラーが投げられる', () => {
      // Given: 0Lot（注文として成立しない）
      // When / Then: 100以上でなければならないためエラー
      expect(() => Lot.of(0)).toThrow('Lotは100以上');
    });

    it('負の数を渡すと、エラーが投げられる', () => {
      // Given: 負の数量（意味をなさない）
      // When / Then: エラー
      expect(() => Lot.of(-1)).toThrow('Lotは100以上');
    });

    it('500,000を超える値を渡すと、エラーが投げられる', () => {
      // Given: 上限超過
      // When / Then: エラー
      expect(() => Lot.of(500_100)).toThrow('Lotは500,000以下');
    });

    it('100の倍数でない値を渡すと、エラーが投げられる', () => {
      // Given: 100の倍数でない値
      // When / Then: エラー
      expect(() => Lot.of(150)).toThrow('Lotは100の倍数');
    });
  });

  describe('等価比較', () => {
    it('同じ数量の Lot どうしは、等価と判定される', () => {
      // Given: 同じ数量の Lot 2つ
      const a = Lot.of(100);
      const b = Lot.of(100);

      // When: equals() で比較する
      // Then: 数量が同じなので等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる数量の Lot どうしは、非等価と判定される', () => {
      // Given: 100Lot と 500Lot
      const a = Lot.of(100);
      const b = Lot.of(500);

      // When / Then: 数量が違うので非等価
      expect(a.equals(b)).toBe(false);
    });
  });
});
