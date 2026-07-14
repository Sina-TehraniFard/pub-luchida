import type { Lot } from './Lot.js';
import type { LotPolicy } from './LotPolicy.js';
import type { LotDecisionInput } from './LotDecisionInput.js';

/**
 * @deprecated Step4 では未実装。Step5 以降で本格対応する。
 *
 * 固定比率 LotPolicy（レガシー実装、Step4 では未稼働）。
 *
 * 旧設計:
 *   lot = floor(capital / unitJpy) × unitLot
 *
 * `LotPolicy` interface 刷新（Step4）で `decide(input)` に統一されたが、
 * 本クラスは現在 `main.ts` から利用されていない（Phase 1 の本番設定再現用に
 * 残してあった）。本格対応は Step5 以降。
 *
 * 設計書: docs/design/position-manager/policies.md 1.8 節 / Step5 で本格対応。
 */
export class FixedRatioLotPolicy implements LotPolicy {
  decide(input: LotDecisionInput): Lot {
    throw new Error(`未実装: Step5 以降で対応 (pair=${input.pair()})`);
  }
}
