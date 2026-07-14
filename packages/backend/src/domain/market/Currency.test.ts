import { describe, it, expect } from 'vitest';
import { ALL_CURRENCIES, type Currency } from './Currency.js';
import { BUSINESS_PAIRS_LIST, CurrencyPair, base, quote } from './CurrencyPair.js';

/**
 * Currency 型は文字列リテラル union のため、コンパイル時の型チェックが第一防衛線。
 * 本テストは「ホワイトリスト通過後の整合検証」を担当する:
 *
 * - `BUSINESS_PAIRS` の各ペアから取り出した base/quote 通貨は、必ず `Currency` の要素である
 * - `BUSINESS_PAIRS` に登録されたペアは「同一通貨ペア（`JPY_JPY` 等）」を含まない（業務ルール）
 *
 * テンプレートリテラル型 `${Currency}_${Currency}` で「`Currency` に未登録の 3 文字が混入する」
 * 事故は型レベルで弾かれる。本テストはそれを補い、`base()` / `quote()` の `as Currency`
 * キャストがランタイム上も真であることを確認する。
 *
 * 業務ペアの定義は `CurrencyPair.ts` の `BUSINESS_PAIRS_LIST` を import し、
 * 通貨集合は `Currency.ts` の `ALL_CURRENCIES` を import する（重複定義禁止）。
 */
const CURRENCY_SET: ReadonlySet<Currency> = new Set<Currency>(ALL_CURRENCIES);

describe('Currency', () => {
  it('全ビジネス通貨ペアの base 通貨は Currency 型の要素である', () => {
    BUSINESS_PAIRS_LIST.forEach((s) => {
      // Given: ビジネスとして取引対象の通貨ペア
      const pair = CurrencyPair(s);

      // When: base 通貨を取り出す
      const c = base(pair);

      // Then: Currency 型の集合に属する（業務ルール: 取引対象通貨はすべて Currency に登録されている）
      expect(CURRENCY_SET.has(c)).toBe(true);
    });
  });

  it('全ビジネス通貨ペアの quote 通貨は Currency 型の要素である', () => {
    BUSINESS_PAIRS_LIST.forEach((s) => {
      // Given: ビジネスとして取引対象の通貨ペア
      const pair = CurrencyPair(s);

      // When: quote 通貨を取り出す
      const c = quote(pair);

      // Then: Currency 型の集合に属する
      expect(CURRENCY_SET.has(c)).toBe(true);
    });
  });

  it('全ビジネス通貨ペアで base ≠ quote（同一通貨ペアは存在しない）', () => {
    BUSINESS_PAIRS_LIST.forEach((s) => {
      // Given: ビジネスとして取引対象の通貨ペア
      const pair = CurrencyPair(s);

      // When: base と quote を取り出す
      const b = base(pair);
      const q = quote(pair);

      // Then: 必ず異なる通貨（業務ルール: JPY_JPY のような同一ペアは
      //   売買として意味を持たないため BUSINESS_PAIRS に含めない）
      expect(b).not.toBe(q);
    });
  });
});
