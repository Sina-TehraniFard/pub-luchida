import { describe, it, expect } from 'vitest';
import { Money } from './Money.js';
import { Ratio } from './Ratio.js';

describe('Money', () => {
  describe('of()', () => {
    it('整数値から Money を生成できる', () => {
      // Given / When: 整数 1000 から JPY を生成
      const money = Money.of(1000, 'JPY');

      // Then: 値と通貨が保持される
      expect(money.toString()).toBe('1000 JPY');
    });

    it('小数値から Money を生成できる', () => {
      // Given / When: 小数 1234.56 から USD を生成
      const money = Money.of(1234.56, 'USD');

      // Then
      expect(money.toString()).toBe('1234.56 USD');
    });

    it('文字列から Money を生成できる', () => {
      // Given / When: 文字列 '999.99' から EUR を生成
      const money = Money.of('999.99', 'EUR');

      // Then
      expect(money.toString()).toBe('999.99 EUR');
    });

    it('負の値から Money を生成できる', () => {
      // Given / When: 損失を表す負値
      const loss = Money.of('-500', 'JPY');

      // Then: 負値も許容される
      expect(loss.isNegative()).toBe(true);
      expect(loss.toString()).toBe('-500 JPY');
    });
  });

  describe('jpy()', () => {
    it('JPY ショートカットで Money を生成できる', () => {
      // Given / When
      const money = Money.jpy(1000);

      // Then: Money.of(1000, 'JPY') と等価
      expect(money.equals(Money.of(1000, 'JPY'))).toBe(true);
      expect(money.currencyCode()).toBe('JPY');
    });

    it('文字列引数の jpy() も動作する', () => {
      // Given / When: 文字列で JPY を生成
      const money = Money.jpy('2500');

      // Then: "2500 JPY" として文字列化される
      expect(money.toString()).toBe('2500 JPY');
    });
  });

  describe('plus()', () => {
    it('同通貨どうしの加算ができる', () => {
      // Given: 1000 JPY と 500 JPY
      const a = Money.jpy(1000);
      const b = Money.jpy(500);

      // When: 加算する
      const sum = a.plus(b);

      // Then: 1500 JPY
      expect(sum.equals(Money.jpy(1500))).toBe(true);
    });

    it('通貨が違うと加算できずエラーになる', () => {
      // Given: JPY と USD
      const yen = Money.jpy(1000);
      const dollar = Money.of(10, 'USD');

      // When / Then: 通貨不一致エラー
      expect(() => yen.plus(dollar)).toThrow('通貨不一致');
    });
  });

  describe('minus()', () => {
    it('同通貨どうしの減算ができる', () => {
      // Given: 1000 JPY から 300 JPY を引く
      const a = Money.jpy(1000);
      const b = Money.jpy(300);

      // When
      const diff = a.minus(b);

      // Then: 700 JPY
      expect(diff.equals(Money.jpy(700))).toBe(true);
    });

    it('引いた結果が負になっても許容される', () => {
      // Given: 100 JPY から 500 JPY を引くと -400 JPY
      const a = Money.jpy(100);
      const b = Money.jpy(500);

      // When
      const diff = a.minus(b);

      // Then: 中間値として負も認める
      expect(diff.isNegative()).toBe(true);
      expect(diff.equals(Money.jpy(-400))).toBe(true);
    });

    it('通貨が違うと減算できずエラーになる', () => {
      // Given: JPY と USD
      const yen = Money.jpy(1000);
      const dollar = Money.of(10, 'USD');

      // When / Then: 通貨不一致エラー
      expect(() => yen.minus(dollar)).toThrow('通貨不一致');
    });
  });

  describe('times()', () => {
    it('Ratio を掛けると比例した金額になる', () => {
      // Given: 100 JPY × Ratio 0.5
      const money = Money.jpy(100);
      const half = Ratio.of(0.5);

      // When
      const result = money.times(half);

      // Then: 50 JPY（通貨は維持）
      expect(result.equals(Money.jpy(50))).toBe(true);
      expect(result.currencyCode()).toBe('JPY');
    });

    it('ゼロ Ratio を掛けると 0 になる', () => {
      // Given: 1000 JPY と Ratio.zero()
      const money = Money.jpy(1000);
      const zero = Ratio.zero();

      // When: ゼロを掛ける
      const result = money.times(zero);

      // Then: 0 JPY（通貨は維持）
      expect(result.isZero()).toBe(true);
      expect(result.currencyCode()).toBe('JPY');
    });

    it('Ratio.one() を掛けると同額になる', () => {
      // Given: 1234 USD
      const money = Money.of(1234, 'USD');

      // When: 1.0 を掛ける
      const result = money.times(Ratio.one());

      // Then: 元の金額と等価
      expect(result.equals(money)).toBe(true);
    });
  });

  describe('isNegative()', () => {
    it('負の Money は true を返す', () => {
      // Given: -100 JPY
      const money = Money.jpy(-100);

      // When / Then: 負値判定が true
      expect(money.isNegative()).toBe(true);
    });

    it('ゼロは負ではない', () => {
      // Given: 0 JPY
      const money = Money.jpy(0);

      // When / Then: ゼロは負ではない
      expect(money.isNegative()).toBe(false);
    });

    it('正の Money は false を返す', () => {
      // Given: 100 JPY
      const money = Money.jpy(100);

      // When / Then: 正値は負ではない
      expect(money.isNegative()).toBe(false);
    });
  });

  describe('isZero()', () => {
    it('ゼロ金額は true を返す', () => {
      // Given: 0 JPY
      const money = Money.jpy(0);

      // When / Then: ゼロ判定が true
      expect(money.isZero()).toBe(true);
    });

    it('正値はゼロではない', () => {
      // Given: 1 JPY
      const money = Money.jpy(1);

      // When / Then: 正値はゼロではない
      expect(money.isZero()).toBe(false);
    });

    it('負値はゼロではない', () => {
      // Given: -1 JPY
      const money = Money.jpy(-1);

      // When / Then: 負値もゼロではない
      expect(money.isZero()).toBe(false);
    });
  });

  describe('equals()', () => {
    it('同通貨同値なら true', () => {
      // Given: 1000 JPY を 2 つ
      const a = Money.jpy(1000);
      const b = Money.jpy(1000);

      // When / Then: 等価
      expect(a.equals(b)).toBe(true);
    });

    it('同通貨で値が違えば false', () => {
      // Given: 1000 JPY と 999 JPY
      const a = Money.jpy(1000);
      const b = Money.jpy(999);

      // When / Then: 非等価
      expect(a.equals(b)).toBe(false);
    });

    it('値が同じでも通貨が違えば false', () => {
      // Given: 1000 JPY と 1000 USD
      const yen = Money.of(1000, 'JPY');
      const dollar = Money.of(1000, 'USD');

      // When / Then: 通貨が違うので非等価
      expect(yen.equals(dollar)).toBe(false);
    });
  });

  describe('toBig()', () => {
    it('内部の Big 値を取得できる', () => {
      // Given: '1234.5' JPY
      const money = Money.jpy('1234.5');

      // When: toBig() で内部の Big を取得
      const big = money.toBig();

      // Then: 元の値が文字列化で取れる
      expect(big.toFixed()).toBe('1234.5');
    });
  });

  describe('currencyCode()', () => {
    it('通貨コードを取得できる', () => {
      // Given: USD と JPY の Money
      const usd = Money.of(100, 'USD');
      const jpy = Money.jpy(100);

      // When / Then: 各々の通貨コードが取れる
      expect(usd.currencyCode()).toBe('USD');
      expect(jpy.currencyCode()).toBe('JPY');
    });
  });

  describe('toString()', () => {
    it('"値 通貨" 形式で文字列化される', () => {
      // Given: JPY / USD / EUR の Money
      const yen = Money.jpy(1000);
      const dollar = Money.of('1234.56', 'USD');
      const euro = Money.of('-500', 'EUR');

      // When / Then: "値 通貨" の形式
      expect(yen.toString()).toBe('1000 JPY');
      expect(dollar.toString()).toBe('1234.56 USD');
      expect(euro.toString()).toBe('-500 EUR');
    });
  });
});
