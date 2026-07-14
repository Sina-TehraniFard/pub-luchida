import { Balance } from '../domain/Balance.js';

/**
 * 口座残高取得の約束事。
 *
 * 鮮度保証の有無で 2 メソッドを使い分ける:
 *   - `current()`: 鮮度非保証。**同期**でキャッシュ参照のみ（I/O を伴わない）。
 *     未取得・期限切れは null。呼び出し側が `?? fallbackBalance` で吸収する経路。
 *   - `freshNow()`: 鮮度保証。キャッシュ期限切れ時は API 直叩きを行うため非同期。
 *     古い残高で発注しないため、API 失敗時は throw（フォールバックしない）。
 *
 * 同期 / 非同期の非対称は意図的: `current()` は呼び出し頻度が高く（Rule 発火毎）
 * I/O を含めない契約とし、`freshNow()` のみ HTTP を許容する。Rule 層を async 汚染
 * しないための設計判断（policies.md 1.5）。
 *
 * Adapter 自身は CAPITAL のような環境変数フォールバックを持たない。
 * フォールバック値は composition root（main.ts）で `Balance` に値オブジェクト化し、
 * `PositionSizingService` のコンストラクタに `fallbackBalance` として注入する。
 *
 * 実装は adapter/gmo/GmoBalanceAdapter.ts が担う（TTL は Adapter 内部実装）。
 *
 * 設計書: docs/design/position-manager/policies.md 1.5 / 1.7 / 1.10.3。
 */
export interface BalancePort {
  /**
   * 鮮度非保証の現在残高を返す。同期メソッドのため I/O を伴わない。
   * キャッシュヒット時はキャッシュ値、未取得・期限切れ・同期では取得不能な場合は null。
   * API 取得が必要なら呼び出し側が `freshNow()` を使う。
   */
  current(): Balance | null;

  /**
   * 鮮度保証の現在残高を返す。
   * 古い残高で発注しないため、必要なら API を叩き直す。
   * API 失敗時は throw する（フォールバックしない）。
   */
  freshNow(): Promise<Balance>;
}
