import Big from 'big.js';
import { quote } from '../market/CurrencyPair.js';
import { Lot } from './Lot.js';
import type { LotPolicy } from './LotPolicy.js';
import type { LotDecisionInput } from './LotDecisionInput.js';
import { requiredMarginBig } from './RequiredMarginCalculator.js';

/**
 * 証拠金維持率ベース LotPolicy（純粋ドメインサービス）。
 *
 * エントリー直後の証拠金維持率が `target` となるよう Lot を決める。
 *
 *   証拠金維持率 = 有効証拠金 / 必要証拠金
 *   必要証拠金 (JPY) = rate × lot × marginRate
 *   lot = floor(capital / (target × rate × marginRate) / 100) × 100
 *
 * JPY quote ペア専用（USD_JPY・EUR_JPY 等）。非 JPY quote は throw。
 *
 * 100 の倍数に切り捨て、下限 100、上限 `Lot.SINGLE_LOT_MAX_UNITS` でクランプする。
 *
 * 状態を持たない（コンストラクタ引数なし）。残高・レート・目標維持率・証拠金率は
 * 全て呼び出し側が `LotDecisionInput` として組み立てて注入する。
 *
 * 設計書: docs/design/position-manager/policies.md 1.8 節。
 */
export class MaintenanceRatioBasedLotPolicy implements LotPolicy {
  /** Lot の最小値は `Lot.SINGLE_LOT_MIN_UNITS` を参照（MAX と対称）。設計憲法 6.1: Big 比較で閉じる。 */
  private static readonly MIN: Big = new Big(Lot.SINGLE_LOT_MIN_UNITS);
  /** Lot の上限は `Lot.SINGLE_LOT_MAX_UNITS` を参照（policy 側で 500_000 を持たない）。 */
  private static readonly MAX: Big = new Big(Lot.SINGLE_LOT_MAX_UNITS);

  decide(input: LotDecisionInput): Lot {
    if (quote(input.pair()) !== 'JPY') {
      throw new Error(`MaintenanceRatioBasedLotPolicy は JPY quote ペア専用: ${input.pair()}`);
    }

    // 設計憲法 6.1: 経路は全て Big。toNumber() は最後 Lot.of に渡す直前のみ。
    const capital = input.balance().toMoney().toBig();
    const rate = input.rate().toBig();
    const target = input.target().toBig();
    const marginRate = input.marginRate().toBig();

    // lot = floor(capital / (target × requiredMarginPerUnit) / 100) × 100
    // requiredMarginPerUnit = rate × marginRate（lot=1 の必要証拠金、Big 経路）
    // SizingResult.of の `rate × lot × marginRate` と同一ファミリの式。
    // RequiredMarginCalculator に集約することで NH-2 防御（式の二重定義回避）。
    const requiredMarginPerUnit = requiredMarginBig(rate, new Big(1), marginRate);
    const raw = capital.div(target.times(requiredMarginPerUnit));
    const rounded = raw.div(100).round(0, Big.roundDown).times(100);

    // クランプは Big 同士で閉じる（憲法 6.1: .toNumber() で比較しない）
    const min = MaintenanceRatioBasedLotPolicy.MIN;
    const max = MaintenanceRatioBasedLotPolicy.MAX;
    const clamped = rounded.lt(min) ? min : rounded.gt(max) ? max : rounded;

    return Lot.of(clamped.toNumber());
  }
}
