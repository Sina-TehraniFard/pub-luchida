/**
 * 業務として取り扱う通貨の単一情報源。
 *
 * `Currency` 型 union と `ALL_CURRENCIES` 配列はこの定義から自動派生する。
 * テスト・ランタイム検証はすべてこの配列を参照すること（重複定義禁止）。
 *
 * 並び順は `JPY` を先頭。クロス円ペアの quote 通貨として最頻出のため。
 *
 * **新通貨を追加するときの修正範囲**:
 * 1. 本配列に通貨コードを追加（型・配列の両方が同時に追従）
 * 2. `BUSINESS_PAIRS`（`CurrencyPair.ts`）に該当ペアを追加
 */
export const ALL_CURRENCIES = [
  'JPY',
  'USD',
  'EUR',
  'GBP',
  'AUD',
  'NZD',
  'CAD',
  'CHF',
  'TRY',
  'ZAR',
  'MXN',
] as const;

/**
 * 通貨種別。`ALL_CURRENCIES` から自動派生（単一情報源）。
 *
 * `BUSINESS_PAIRS`（CurrencyPair.ts）で使用する全通貨を網羅する。
 * `Money` / `Balance` などの金額系 VO で「通貨整合チェック」を型レベルで担保するために使う。
 *
 * 演算を持たない識別子的な値のため、class ではなく文字列リテラル union として定義する
 * （value-objects.md `CurrencyPair` 章「branded string 採用の判断」と同じ方針）。
 */
export type Currency = (typeof ALL_CURRENCIES)[number];
