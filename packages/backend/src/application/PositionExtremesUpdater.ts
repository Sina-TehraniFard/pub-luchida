import { ExtremeTracker } from '../domain/position/ExtremeTracker.js';
import type { ExtremesSnapshot } from '../domain/position/ExtremesSnapshot.js';
import type { PositionId } from '../domain/position/PositionId.js';
import type { PositionExtremesPort } from '../port/PositionExtremesPort.js';
import type { PositionExtremesWriter } from '../port/PositionExtremesWriter.js';
import type { PositionRepository } from '../port/PositionRepository.js';
import { currencyPairEquals, type CurrencyPair } from '../domain/market/CurrencyPair.js';
import type { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';

/**
 * 全 OPEN ポジションの極値追跡を進める application service。
 * `PositionExtremesPort`（Reader: find/remove）と `PositionExtremesWriter`（update）の両方を実装する。
 * 注入側で interface を絞ることで、ExitDispatcher は update を呼べない、TradingSession は find/remove を呼べない構造になる。
 *
 * 設計書: docs/design/position-manager/step8-pr-b-impl-plan.md Step 3。
 */
export class PositionExtremesUpdater implements PositionExtremesPort, PositionExtremesWriter {
  constructor(
    private readonly positionRepository: PositionRepository,
    private readonly tracker: ExtremeTracker = new ExtremeTracker(),
  ) {}

  async update(pair: CurrencyPair, snapshot: MarketSnapshot): Promise<void> {
    if (!currencyPairEquals(snapshot.pair, pair)) {
      throw new Error(
        `PositionExtremesUpdater.update: pair と snapshot.pair が不一致: pair=${pair}, snapshot.pair=${snapshot.pair}`,
      );
    }
    const forPair = (await this.positionRepository.openPositions()).forPair(pair);
    for (const position of forPair) {
      this.tracker.update(
        position.id.toString(),
        snapshot.tick.bid(),
        snapshot.tick.ask(),
        position.buySell,
      );
    }
  }

  find(positionId: PositionId): ExtremesSnapshot | undefined {
    return this.tracker.get(positionId.toString());
  }

  remove(positionId: PositionId): void {
    this.tracker.remove(positionId.toString());
  }
}
