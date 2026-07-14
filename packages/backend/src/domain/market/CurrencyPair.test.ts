import { describe, it, expect } from 'vitest';
import Big from 'big.js';
import {
  BUSINESS_PAIRS_LIST,
  CurrencyPair,
  base,
  currencyPairEquals,
  pipUnit,
  quote,
} from './CurrencyPair.js';

describe('CurrencyPair', () => {
  describe('生成', () => {
    it('全ビジネス通貨ペアが生成成功する', () => {
      // Given: BUSINESS_PAIRS_LIST の全件（CurrencyPair.ts の単一情報源）
      // When: 各ペアを CurrencyPair() に通す
      // Then: 同じ文字列が型として保持される（追加忘れ・削除忘れに気づく）
      BUSINESS_PAIRS_LIST.forEach((s) => {
        const result = CurrencyPair(s);
        expect(result).toBe(s);
      });
    });

    it('ビジネスとして取引対象としない通貨ペアを渡すと、エラーが投げられる', () => {
      // Given: BUSINESS_PAIRS に含まれない通貨ペアの文字列（順序が逆・対象外）
      const invalidPair = 'JPY_USD';

      // When: CurrencyPair() を呼ぶ
      // Then: 未対応であることを示すエラーが投げられる
      expect(() => CurrencyPair(invalidPair)).toThrow('未対応の通貨ペア');
    });

    it('空文字を渡すと、エラーが投げられる', () => {
      // Given: 空の文字列
      const value = '';

      // When: CurrencyPair() を呼ぶ
      // Then: 通貨ペアとして認識できないためエラー
      expect(() => CurrencyPair(value)).toThrow('未対応の通貨ペア');
    });
  });

  describe('等価比較', () => {
    it('同じ通貨ペアどうしを比較すると、等価と判定される', () => {
      // Given: 同じ通貨ペア 2 つ
      const a = CurrencyPair('USD_JPY');
      const b = CurrencyPair('USD_JPY');

      // When: currencyPairEquals() で比較する
      const result = currencyPairEquals(a, b);

      // Then: 等価
      expect(result).toBe(true);
    });

    it('異なる通貨ペアどうしを比較すると、非等価と判定される', () => {
      // Given: 異なる通貨ペア 2 つ
      const a = CurrencyPair('USD_JPY');
      const b = CurrencyPair('EUR_JPY');

      // When: currencyPairEquals() で比較する
      const result = currencyPairEquals(a, b);

      // Then: 非等価
      expect(result).toBe(false);
    });
  });

  describe('base / quote 通貨の取得', () => {
    it('JPY quote ペアから base / quote 通貨を取得できる', () => {
      // Given: クロス円ペア
      const pair = CurrencyPair('USD_JPY');

      // When: base / quote を取り出す
      const b = base(pair);
      const q = quote(pair);

      // Then: 命名規則 BASE_QUOTE どおりに分解される
      expect(b).toBe('USD');
      expect(q).toBe('JPY');
    });

    it('USD quote ペアから base / quote 通貨を取得できる', () => {
      // Given: ドルストレート（quote が USD）のペア
      const pair = CurrencyPair('EUR_USD');

      // When: base / quote を取り出す
      const b = base(pair);
      const q = quote(pair);

      // Then: 命名規則 BASE_QUOTE どおりに分解される
      expect(b).toBe('EUR');
      expect(q).toBe('USD');
    });

    it('全ビジネスペアで base / quote が 3 文字 + 3 文字に分解される', () => {
      // Given: BUSINESS_PAIRS_LIST の全件
      BUSINESS_PAIRS_LIST.forEach((s) => {
        const p = CurrencyPair(s);
        const [expectedBase, expectedQuote] = s.split('_');

        // Then: 命名規則に沿って正しく分解される
        expect(base(p)).toBe(expectedBase);
        expect(quote(p)).toBe(expectedQuote);
      });
    });
  });

  describe('pipUnit', () => {
    it('JPY quote ペアの pipUnit は Big("0.01")', () => {
      // Given: クロス円ペア（pip 単位は 0.01 円）
      const pair = CurrencyPair('USD_JPY');

      // When: pipUnit を取り出す
      const result = pipUnit(pair);

      // Then: Big で 0.01（端数誤差なし）
      expect(result).toBeInstanceOf(Big);
      expect(result.eq(new Big('0.01'))).toBe(true);
    });

    it('JPY 以外 quote ペアの pipUnit は Big("0.0001")', () => {
      // Given: ドルストレートペア
      const pair = CurrencyPair('EUR_USD');

      // When: pipUnit を取り出す
      const result = pipUnit(pair);

      // Then: Big で 0.0001
      expect(result).toBeInstanceOf(Big);
      expect(result.eq(new Big('0.0001'))).toBe(true);
    });
  });
});
