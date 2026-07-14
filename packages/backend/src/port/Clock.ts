/**
 * 時刻取得の約束事。
 *
 * テスト容易性と鮮度判定の決定性のため、現在時刻を直接 `new Date()` で取らずに
 * `Clock` 経由で取得する。Adapter 層・Application 層のキャッシュ TTL や
 * `RatePort.currentFresh` の鮮度閾値判定で利用する。
 *
 * 実装は infrastructure/time/SystemClock.ts（本番）/ テストの Fake が担う。
 */
export interface Clock {
  now(): Date;
}
