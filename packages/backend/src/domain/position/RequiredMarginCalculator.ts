import Big from 'big.js';
import { Money } from '../Money.js';
import type { Rate } from '../market/Rate.js';
import type { Lot } from './Lot.js';
import type { MarginRate } from './MarginRate.js';

/**
 * 必要証拠金 = rate × lot × marginRate を計算する純粋関数の集約。
 *
 * SizingResult（戻り値: Money）と MaintenanceRatioBasedLotPolicy（逆算経路で
 * 使う Big）の双方から呼ばれ、必要証拠金算出の単一情報源（NH-2 防御）となる。
 *
 * JPY quote ペア前提（rate.pair() の quote 通貨が JPY であること）。
 * 通貨ペア整合は呼び出し側が `LotDecisionInput.of` で保証する。
 *
 * 設計書: docs/design/position-manager/policies.md 1.4。
 */

/** Big 経路の純粋計算。LotPolicy のような Big 演算ループ内で使う。 */
export function requiredMarginBig(rate: Big, lotUnits: Big, marginRate: Big): Big {
  return rate.times(lotUnits).times(marginRate);
}

/**
 * Money 経路。SizingResult 等から使う。JPY 整数に丸める。
 * `Big.roundHalfUp` を **明示**して丸めるため、グローバル `Big.RM` の変更影響を受けない
 * （0.5 ちょうどは切り上げ、例: 600.5 → 601）。境界挙動は test で pin。
 */
export function requiredMarginAsJpy(rate: Rate, lot: Lot, marginRate: MarginRate): Money {
  const big = requiredMarginBig(rate.toBig(), new Big(lot.toNumber()), marginRate.toBig());
  return Money.jpy(big.round(0, Big.roundHalfUp).toFixed(0));
}
