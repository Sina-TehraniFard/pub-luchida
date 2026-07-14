import Big from 'big.js';
import type { Currency } from './Currency.js';

/**
 * 命名規則 BASE_QUOTE で表現できる通貨ペア文字列の型。
 *
 * `Currency` union のすべての組合せ（11 × 11 = 121 通り）を許容するテンプレートリテラル型。
 * 「`Currency` 型に未登録の通貨が `BUSINESS_PAIRS` に紛れ込む」事故を型レベルで防ぐ。
 *
 * 型レベル防御の限界:
 *   順序逆転（`JPY_USD`）や同一通貨ペア（`JPY_JPY`）まではコンパイル時に弾けない。
 *   それらは `CurrencyPair()` ファクトリの `BUSINESS_PAIRS.has(...)` で実行時に拒否する。
 *   型は「`Currency` に登録されていない 3 文字が混入する」第一防衛線として機能する。
 */
type AnyPair = `${Currency}_${Currency}`;

/**
 * ビジネスとして取引対象とする通貨ペアの**単一情報源**。
 * 新しい通貨ペアへの参入はビジネス判断（ここを変更する）。
 *
 * `as const satisfies readonly AnyPair[]` で型を縛っているため、`Currency` から通貨を消すと
 * 該当エントリがコンパイルエラーになる。
 *
 * 並び順は「JPY quote 10 件 → 非 JPY quote 4 件」。テストもこの定義を import して使う
 * （重複定義禁止）。
 *
 * ブローカー制約は Adapter 層が持つ。ドメインは「ビジネスとして扱う通貨ペア」だけを知っていればよい。
 */
export const BUSINESS_PAIRS_LIST = [
  'USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY',
  'NZD_JPY', 'CAD_JPY', 'CHF_JPY', 'TRY_JPY', 'ZAR_JPY', 'MXN_JPY',
  'EUR_USD', 'GBP_USD', 'AUD_USD', 'NZD_USD',
] as const satisfies readonly AnyPair[];

const BUSINESS_PAIRS: ReadonlySet<AnyPair> = new Set<AnyPair>(BUSINESS_PAIRS_LIST);

/**
 * `CurrencyPair` は branded string として実装する（`AnyPair & { __brand }`）。
 *
 * 演算を持たない識別子的な値オブジェクトのため class ではなく branded string を採用。
 * 採用判断の根拠は `docs/design/value-objects.md` の `CurrencyPair` 章を参照。
 *
 * 同じ識別子 `CurrencyPair` を type と function 両方で export している（TS の合法な記法）:
 *   - type 名: 値の型としての `CurrencyPair`
 *   - function 名: ファクトリ関数としての `CurrencyPair(value)`
 * これは `BuySell` など他の識別子的 VO と統一した規約。
 */
export type CurrencyPair = AnyPair & { readonly __brand: 'CurrencyPair' };

/**
 * `CurrencyPair` を生成する。
 *
 * 主に **Adapter 境界（GMO API レスポンス・DB レコード）** からの生成を想定する。
 * 文字列が `BUSINESS_PAIRS` のホワイトリストを通った場合のみ branded 型として返す。
 *
 * ドメイン内部で既知のペアを生成する場合も `CurrencyPair('USD_JPY')` の形で書く。
 * タイポは `BUSINESS_PAIRS` 通過時に実行時例外で検出される。
 */
export function CurrencyPair(value: string): CurrencyPair {
  if (!BUSINESS_PAIRS.has(value as AnyPair)) {
    throw new Error(`未対応の通貨ペア: ${value}`);
  }
  return value as CurrencyPair;
}

/**
 * 通貨ペアの等価比較。
 *
 * branded string 採用前提では `a === b` と等価だが、ドメインの語彙として
 * 「等価比較を行う意図」を呼び出し側で明示するために残している（読み下しシンタックスシュガー）。
 *
 * 利用箇所: `OpenPositions.hasPositionFor`, `MarketSnapshot.equals`。
 */
export function currencyPairEquals(a: CurrencyPair, b: CurrencyPair): boolean {
  return a === b;
}

/**
 * base 通貨を返す（命名規則 BASE_QUOTE の左側）。
 * 例: USD_JPY → USD、EUR_USD → EUR
 *
 * 利用想定: Step 1 以降の `Money` / `Balance` で「base 通貨で表す金額」を扱う際の通貨整合チェック。
 *
 * 型安全性: `pair` は `CurrencyPair()` ファクトリで `BUSINESS_PAIRS` のホワイトリストを通った
 * 値のみを受けるため、ランタイム上 `pair.slice(0, 3)` は必ず `Currency` の要素となる。
 * `as Currency` キャストはこのホワイトリスト通過後の前提に基づく。
 */
export function base(pair: CurrencyPair): Currency {
  return pair.slice(0, 3) as Currency;
}

/**
 * quote 通貨を返す（命名規則 BASE_QUOTE の右側）。
 * 例: USD_JPY → JPY、EUR_USD → USD
 *
 * 利用想定: `Balance` の通貨と `Rate` の quote 通貨が一致するかの整合チェック
 *   （value-objects.md `LotDecisionInput` 制約）。
 *
 * 型安全性: `base()` と同じく、`BUSINESS_PAIRS` 通過後の前提に基づく `as Currency` キャスト。
 */
export function quote(pair: CurrencyPair): Currency {
  return pair.slice(-3) as Currency;
}

const PIP_UNIT_JPY_QUOTE: Big = new Big('0.01');
const PIP_UNIT_NON_JPY_QUOTE: Big = new Big('0.0001');

/**
 * 通貨ペアの 1 pip の小数単位（pip size）を返す。
 *
 * - JPY quote（クロス円）: 0.01
 * - それ以外（ドルストレート等）: 0.0001
 *
 * 設計憲法 6.1（経路は全て Big、`number` リテラルで端数誤差を入れない）に従い `Big` で返す。
 * `Pips` ↔ `Rate` 換算で利用する。
 *
 * GC 効率と精度のため、結果の `Big` インスタンスはモジュールレベルで一度だけ生成し再利用する。
 */
export function pipUnit(pair: CurrencyPair): Big {
  return quote(pair) === 'JPY' ? PIP_UNIT_JPY_QUOTE : PIP_UNIT_NON_JPY_QUOTE;
}
