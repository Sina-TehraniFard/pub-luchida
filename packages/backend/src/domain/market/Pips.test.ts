import { describe, it, expect } from 'vitest';
import { Pips } from './Pips.js';

describe('Pips', () => {
  describe('isPositive()', () => {
    it('利益を表す正の Pips は、isPositive() が true を返す', () => {
      // Given: 10 pips の利益
      const profit = Pips.of('10');

      // When: isPositive() で正負を確認する
      // Then: 利益なので true
      expect(profit.isPositive()).toBe(true);
    });

    it('損失を表す負の Pips は、isPositive() が false を返す', () => {
      // Given: 5 pips の損失
      const loss = Pips.of('-5');

      // When / Then: 損失なので false
      expect(loss.isPositive()).toBe(false);
    });

    it('損益ゼロの Pips は、isPositive() が false を返す', () => {
      // Given: トントン（0 pips）
      const breakEven = Pips.of('0');

      // When / Then: 利益ではないので false
      expect(breakEven.isPositive()).toBe(false);
    });
  });

  describe('isNegative()', () => {
    it('利益を表す正の Pips は、isNegative() が false を返す', () => {
      // Given: 10 pips の利益
      const profit = Pips.of('10');

      // When: isNegative() で負かどうかを確認する
      // Then: 利益なので false
      expect(profit.isNegative()).toBe(false);
    });

    it('損失を表す負の Pips は、isNegative() が true を返す', () => {
      // Given: 5 pips の損失
      const loss = Pips.of('-5');

      // When: isNegative() で負かどうかを確認する
      // Then: 損失なので true
      expect(loss.isNegative()).toBe(true);
    });

    it('損益ゼロの Pips は、isNegative() が false を返す', () => {
      // Given: トントン（0 pips）
      const breakEven = Pips.of('0');

      // When: isNegative() で負かどうかを確認する
      // Then: ゼロは負ではないので false
      expect(breakEven.isNegative()).toBe(false);
    });
  });

  describe('isGreaterThan()', () => {
    it('利確ラインを損切りラインと比較すると、利確ラインの方が大きいと判定される', () => {
      // Given: 利確ライン 20 pips・損切りライン 10 pips
      const takeProfit = Pips.of('20');
      const stopLoss = Pips.of('10');

      // When: isGreaterThan() で比較する
      // Then: 利確ラインの方が大きい
      expect(takeProfit.isGreaterThan(stopLoss)).toBe(true);
      expect(stopLoss.isGreaterThan(takeProfit)).toBe(false);
    });
  });
});
