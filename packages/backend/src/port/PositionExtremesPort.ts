import type { PositionId } from '../domain/position/PositionId.js';
import type { ExtremesSnapshot } from '../domain/position/ExtremesSnapshot.js';

/**
 * ポジションの極値追跡へのアクセス Port（Reader）。
 * `find` は未追跡時 `undefined` を返す。`remove` は冪等。
 * 更新責務は `PositionExtremesWriter` 経由（本 Port には含まれない）。
 *
 * Note (配線契約):
 *   呼び出し側（PR C 以降の `TradingSession`）は **同一 tick 内で `Writer.update` を
 *   `find` より前に実行する**。順序違反時、`find` は `undefined` を返し、ExitDispatcher は
 *   `skipped(reason: 'extremes_unavailable')` として次 tick での再評価に委ねる。
 *
 * 設計書: docs/design/position-manager/step8-pr-b-impl-plan.md Step 2。
 */
export interface PositionExtremesPort {
  find(positionId: PositionId): ExtremesSnapshot | undefined;
  remove(positionId: PositionId): void;
}
