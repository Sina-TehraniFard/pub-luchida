import type { Lot } from './Lot.js';
import type { LotPolicy } from './LotPolicy.js';
import type { LotDecisionInput } from './LotDecisionInput.js';

/**
 * @deprecated Step4 では未実装。Step5 以降で本格対応する。
 *
 * リスクベース LotPolicy（レガシー実装、Step4 では未稼働）。
 *
 * 旧設計:
 *   lot = floor((capital × riskPct) / (slPips × pipValueJpy))
 *
 * `LotPolicy` interface 刷新（Step4）に伴い `slPips` を引数から失ったため、
 * このフェーズでは LotDecisionInput だけからは Lot を算出できない。
 *
 * 本クラスは現在 `main.ts` から利用されていない。本格対応は Step5 以降で
 * RiskInput（slPips を含む別の VO）を導入してから決める方針。
 *
 * 設計書: docs/design/position-manager/policies.md 1.8 節 / Step5 で本格対応。
 */
export class RiskBasedLotPolicy implements LotPolicy {
  decide(input: LotDecisionInput): Lot {
    throw new Error(`未実装: Step5 以降で対応 (pair=${input.pair()})`);
  }
}
