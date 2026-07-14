import { describe, it, expect } from 'vitest';
import { Price } from './Price.js';

describe('Price', () => {
  describe('生成', () => {
    it('正の価格文字列を渡すと、その価格が生成される', () => {
      // Given: USD/JPY の有効な価格
      const value = '150.123';

      // When: Price.of() で生成する
      const price = Price.of(value);

      // Then: 同じ値が文字列で取り出せる
      expect(price.toString()).toBe('150.123');
    });

    it('ゼロを渡すと、エラーが投げられる（価格は正の数のみ有効）', () => {
      // Given: ゼロ（FX 価格として無効）
      // When / Then: 正の数でないためエラー
      expect(() => Price.of('0')).toThrow('価格は正の数');
    });

    it('負の価格を渡すと、エラーが投げられる', () => {
      // Given: 負の価格（現実に存在しない）
      // When / Then: 正の数でないためエラー
      expect(() => Price.of('-1.5')).toThrow('価格は正の数');
    });
  });

  describe('等価比較', () => {
    it('同じ価格どうしを比較すると、等価と判定される', () => {
      // Given: 同じ価格を表す 2つの Price
      const a = Price.of('150.500');
      const b = Price.of('150.5');

      // When: equals() で比較する
      // Then: 末尾ゼロの有無によらず等価（金融計算での同一性）
      expect(a.equals(b)).toBe(true);
    });

    it('異なる価格どうしを比較すると、非等価と判定される', () => {
      // Given: 1銭異なる 2つの価格
      const a = Price.of('150.5');
      const b = Price.of('150.6');

      // When / Then: 1銭でも違えば別の価格
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('減算', () => {
    it('2つの価格の差を計算すると、正確な差額が返る', () => {
      // Given: ask 価格と bid 価格（浮動小数点で誤差が出やすい値）
      const ask = Price.of('150.501');
      const bid = Price.of('150.499');

      // When: minus() で差額を求める
      const diff = ask.minus(bid);

      // Then: 0.002（2銭）が正確に返る（number 演算では誤差が出る値）
      expect(diff.toString()).toBe('0.002');
    });

    it('小さい価格から大きい価格を引くと、負の差額が返る（陰線相当）', () => {
      // Given: 陰線の open 価格と close 価格（close < open）
      const open = Price.of('150.000');
      const close = Price.of('149.500');

      // When: close.minus(open) で差額を求める
      const diff = close.minus(open);

      // Then: -0.5 が返る（陰線では終値が始値を下回るため負になる）
      expect(diff.toString()).toBe('-0.5');
    });
  });

  describe('仲値計算', () => {
    it('ask と bid の中間値が正確に返る', () => {
      // Given: ask 価格と bid 価格
      const ask = Price.of('150.500');
      const bid = Price.of('150.300');

      // When: midBetween() で仲値を求める
      const midPrice = ask.midBetween(bid);

      // Then: 150.4 が正確に返る
      expect(midPrice.toString()).toBe('150.4');
    });

    it('浮動小数点誤差が出やすい値でも正確な中間値が返る', () => {
      // Given: number 演算では誤差が出やすい値
      const ask = Price.of('0.3');
      const bid = Price.of('0.1');

      // When: midBetween() で中間値を求める
      const mid = ask.midBetween(bid);

      // Then: 0.2 が正確に返る（number 演算では 0.2 にならない場合がある）
      expect(mid.toString()).toBe('0.2');
    });
  });

  describe('大小比較', () => {
    it('大きい価格が小さい価格より大きいと判定される', () => {
      // Given: 異なる 2つの価格
      const higher = Price.of('151.0');
      const lower = Price.of('150.0');

      // When: isHigherThan() で比較する
      // Then: 大きい側が true
      expect(higher.isHigherThan(lower)).toBe(true);
      expect(lower.isHigherThan(higher)).toBe(false);
    });
  });
});
