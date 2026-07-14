import { describe, it, expect } from 'vitest';
import { Spread } from './Spread.js';
import { Price } from './Price.js';
import { Pips } from './Pips.js';

describe('Spread', () => {
  describe('of()', () => {
    it('ask が bid より高い場合、Spread が生成される', () => {
      // Given: USD/JPY の ask=150.5、bid=150.3
      const ask = Price.of('150.5');
      const bid = Price.of('150.3');

      // When: Spread.of() で生成する
      const spread = Spread.of(ask, bid);

      // Then: ask と bid を保持し、value() でスプレッド幅（Pips）が返る
      expect(spread.ask.equals(ask)).toBe(true);
      expect(spread.bid.equals(bid)).toBe(true);
      expect(spread.value().equals(Pips.of('0.2'))).toBe(true);
    });

    it('ask と bid が同じ価格の場合、エラーが投げられる（スプレッドはゼロにならない）', () => {
      // Given: ask と bid が同値（実際の FX では起こりえない状態）
      const price = Price.of('150.0');

      // When / Then: スプレッドは必ず正の数でなければならないためエラー
      expect(() => Spread.of(price, price)).toThrow('スプレッドは正の数');
    });

    it('ask が bid より低い場合、エラーが投げられる（不正な気配値）', () => {
      // Given: ask < bid という逆転した気配値（データ異常）
      const ask = Price.of('150.0');
      const bid = Price.of('150.5');

      // When / Then: 気配値として不正なためエラー
      expect(() => Spread.of(ask, bid)).toThrow('スプレッドは正の数');
    });

    it('異なる ask/bid でも同じ ask/bid を持つ Spread は等価と判定される', () => {
      // Given: 同じ ask/bid のペアで生成した 2つの Spread
      const spread1 = Spread.of(Price.of('150.5'), Price.of('150.3'));
      const spread2 = Spread.of(Price.of('150.5'), Price.of('150.3'));

      // When: equals() で比較する
      // Then: ask/bid が同じなので等価
      expect(spread1.equals(spread2)).toBe(true);
    });

    it('異なる ask/bid から同じ差額が生まれても非等価と判定される', () => {
      // Given: 差額は同じ 0.2 だが、ask/bid が異なる 2つの Spread
      const spread1 = Spread.of(Price.of('150.5'), Price.of('150.3'));
      const spread2 = Spread.of(Price.of('151.0'), Price.of('150.8'));

      // When: equals() で比較する
      // Then: ask/bid が異なるため非等価
      expect(spread1.equals(spread2)).toBe(false);
    });
  });

  describe('value()', () => {
    it('value() は ask と bid の差額を Pips で返す', () => {
      // Given: ask=150.501、bid=150.499（差額 0.002）
      const spread = Spread.of(Price.of('150.501'), Price.of('150.499'));

      // When: value() を呼ぶ
      const pips = spread.value();

      // Then: 差額の 0.002 が Pips として返る
      expect(pips.equals(Pips.of('0.002'))).toBe(true);
    });
  });

  describe('toString()', () => {
    it('toString() は ask, bid, value を含む文字列を返す', () => {
      // Given: ask=150.5、bid=150.3 の Spread
      const spread = Spread.of(Price.of('150.5'), Price.of('150.3'));

      // When: toString() を呼ぶ
      const result = spread.toString();

      // Then: ask, bid, value を含む
      expect(result).toBe('Spread(ask=150.5, bid=150.3, value=0.2)');
    });
  });
});
