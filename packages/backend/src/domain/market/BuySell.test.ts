import { describe, it, expect } from 'vitest';
import { BuySell, opposite } from './BuySell.js';

describe('BuySell', () => {
  describe('opposite()', () => {
    it('BUY を渡すと、反対方向の SELL が返る', () => {
      // Given: 買い方向のポジション
      const side = BuySell.BUY;

      // When: opposite() で反対方向を求める
      const result = opposite(side);

      // Then: 売り方向が返る
      expect(result).toBe(BuySell.SELL);
    });

    it('SELL を渡すと、反対方向の BUY が返る', () => {
      // Given: 売り方向のポジション
      const side = BuySell.SELL;

      // When: opposite() で反対方向を求める
      const result = opposite(side);

      // Then: 買い方向が返る
      expect(result).toBe(BuySell.BUY);
    });

    it('2回 opposite() を適用すると、元の方向に戻る', () => {
      // Given: 任意の売買方向
      const original = BuySell.BUY;

      // When: opposite() を 2回適用する
      const result = opposite(opposite(original));

      // Then: 元の方向に戻る（対称性の確認）
      expect(result).toBe(original);
    });
  });
});
