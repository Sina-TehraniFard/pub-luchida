import type { CurrencyPair } from '../domain/market/CurrencyPair.js';
import type { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';

/**
 * ポジションの極値追跡の更新責務を表す Writer Port。
 * Reader 責務（`find` / `remove`）の `PositionExtremesPort` と分離（ISP/CQS）。
 *
 * `ExitDispatcher` には Reader を、`TradingSession` には Writer を注入することで、
 * 「ExitDispatcher が誤って update を呼ぶ」事故を型レベルで防ぐ。
 *
 * 設計書: docs/design/position-manager/step8-pr-b-impl-plan.md。
 */
export interface PositionExtremesWriter {
  update(pair: CurrencyPair, snapshot: MarketSnapshot): Promise<void>;
}
