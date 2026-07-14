import { describe, it, expect } from 'vitest';
import { Balance } from './Balance.js';
import { Money } from './Money.js';
import { Ratio } from './Ratio.js';

describe('Balance', () => {
  describe('of()', () => {
    it('正の Money から Balance を生成できる', () => {
      // Given / When: 1000 JPY から Balance を生成
      const balance = Balance.of(Money.jpy(1000));

      // Then: 内部の Money が保持される
      expect(balance.toMoney().equals(Money.jpy(1000))).toBe(true);
    });

    it('ゼロ Money から Balance を生成できる', () => {
      // Given / When: 0 JPY から Balance を生成
      const balance = Balance.of(Money.jpy(0));

      // Then: ゼロ残高として生成される
      expect(balance.isZero()).toBe(true);
    });

    it('負の Money からは生成できずエラーになる', () => {
      // Given: 負の Money
      const negative = Money.jpy(-1);

      // When / Then: 非負制約違反
      expect(() => Balance.of(negative)).toThrow('Balance は非負');
    });
  });

  describe('multipliedBy()', () => {
    it('Ratio を掛けると按分された Money が返る', () => {
      // Given: 1000 JPY の残高に 4% を掛ける
      const balance = Balance.of(Money.jpy(1000));
      const ratio = Ratio.of('0.04');

      // When: 比率を掛ける
      const allocated = balance.multipliedBy(ratio);

      // Then: 40 JPY
      expect(allocated.equals(Money.jpy(40))).toBe(true);
    });

    it('Ratio.zero() を掛けると 0 Money が返る', () => {
      // Given: 1000 JPY の残高
      const balance = Balance.of(Money.jpy(1000));

      // When: ゼロを掛ける
      const allocated = balance.multipliedBy(Ratio.zero());

      // Then: 0 JPY（通貨は維持）
      expect(allocated.isZero()).toBe(true);
      expect(allocated.currencyCode()).toBe('JPY');
    });
  });

  describe('minus()', () => {
    it('通常の減算で残高が減る', () => {
      // Given: 1000 JPY から 300 JPY を引く
      const balance = Balance.of(Money.jpy(1000));

      // When: 減算を行う
      const next = balance.minus(Money.jpy(300));

      // Then: 700 JPY
      expect(next.toMoney().equals(Money.jpy(700))).toBe(true);
    });

    it('ちょうど 0 になる減算は許容される', () => {
      // Given: 500 JPY からちょうど 500 JPY を引く
      const balance = Balance.of(Money.jpy(500));

      // When: 同額を引く
      const next = balance.minus(Money.jpy(500));

      // Then: ゼロ残高
      expect(next.isZero()).toBe(true);
    });

    it('負になる減算はエラーになる', () => {
      // Given: 100 JPY から 500 JPY を引こうとする
      const balance = Balance.of(Money.jpy(100));

      // When / Then: 残高不足エラー
      expect(() => balance.minus(Money.jpy(500))).toThrow('Balance を差し引くと負になります');
    });
  });

  describe('isZero()', () => {
    it('ゼロ残高は true を返す', () => {
      // Given: 0 JPY の Balance
      const balance = Balance.of(Money.jpy(0));

      // When / Then: ゼロ残高判定が true
      expect(balance.isZero()).toBe(true);
    });

    it('正の残高は false を返す', () => {
      // Given: 1 JPY の Balance
      const balance = Balance.of(Money.jpy(1));

      // When / Then: ゼロ残高判定が false
      expect(balance.isZero()).toBe(false);
    });
  });

  describe('toMoney()', () => {
    it('内部の Money を取得できる', () => {
      // Given: 1234 JPY の Balance
      const balance = Balance.of(Money.jpy(1234));

      // When: 内部 Money を取り出す
      const money = balance.toMoney();

      // Then: 元の Money と等価
      expect(money.equals(Money.jpy(1234))).toBe(true);
    });
  });

  describe('equals()', () => {
    it('同一 Money の Balance どうしは true', () => {
      // Given: 1000 JPY の Balance を 2 つ
      const a = Balance.of(Money.jpy(1000));
      const b = Balance.of(Money.jpy(1000));

      // When / Then: 等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる Money の Balance どうしは false', () => {
      // Given: 1000 JPY と 999 JPY
      const a = Balance.of(Money.jpy(1000));
      const b = Balance.of(Money.jpy(999));

      // When / Then: 非等価
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('内部の Money の toString と一致する', () => {
      // Given: 1234 JPY の Balance
      const money = Money.jpy(1234);
      const balance = Balance.of(money);

      // When / Then: Money.toString() に委譲しているので同一文字列
      expect(balance.toString()).toBe(money.toString());
    });

    it('ゼロ残高でも Money の toString と一致する', () => {
      // Given: 0 JPY の Balance
      const money = Money.jpy(0);
      const balance = Balance.of(money);

      // When / Then: ゼロでも委譲結果と一致
      expect(balance.toString()).toBe(money.toString());
    });
  });
});
