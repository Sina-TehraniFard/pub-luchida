import { quote, type CurrencyPair } from './CurrencyPair.js';

/**
 * BT の複利計算用: 円口座での 1 lot あたりの pip 価値（円）を返す。
 *
 * - JPY quote ペア（USD/JPY 等）: pip 単位 0.01 がそのまま円
 * - USD quote ペア（EUR/USD 等）: pip 単位 0.0001 USD × USD/JPY レート
 *
 * USD/JPY レートは 20 年平均（2006-2026）の概算値 130 を使用する。
 * 厳密には各時点の実レートで換算すべきだが、戦略比較用途では十分な精度。
 *
 * **Phase 2 のスコープ外**: USD/JPY 130 ハードコード解消は別 issue で対応。
 */
export function pipValuePerLotJpy(pair: CurrencyPair): number {
  const usdJpyRate = 130;
  if (quote(pair) === 'JPY') {
    return 0.01;
  }
  return 0.0001 * usdJpyRate;
}
