import Big from 'big.js';
import type { ExitRule } from '../ExitRule.js';
import { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import { Position } from '../../position/Position.js';
import { ExitCommand, ExitType } from '../../command/ExitCommand.js';
import { DoNothing } from '../../command/DoNothing.js';
import { ExitReason } from '../../command/ExitReason.js';
import { pipUnit } from '../../market/CurrencyPair.js';

/**
 * 固定利確による決済判定。
 * エントリー価格から指定 pips 順行したら利確する。
 * BUY ポジション → bid（売り決済価格）で判定
 * SELL ポジション → ask（買い決済価格）で判定
 */
export class FixedTakeProfitExitRule implements ExitRule {
  private readonly takeProfitPips: number;

  constructor(takeProfitPips: number = 150) {
    this.takeProfitPips = takeProfitPips;
  }

  shouldExit(snapshot: MarketSnapshot, position: Position): ExitCommand | DoNothing {
    const currentPrice = position.buySell === 'BUY'
      ? snapshot.tick.bid()
      : snapshot.tick.ask();

    const currentBig = currentPrice.toBig();
    const entryBig = position.entryPrice.toBig();

    // 順行幅を計算（円）
    const favorableMove = position.buySell === 'BUY'
      ? currentBig.minus(entryBig)
      : entryBig.minus(currentBig);

    // pips換算（通貨ペアに応じた pip 単位）
    const unit = pipUnit(snapshot.pair);
    const takeProfitThreshold = new Big(this.takeProfitPips).times(unit);

    if (favorableMove.gte(takeProfitThreshold)) {
      return ExitCommand.of({
        positionId: position.id,
        type: ExitType.TAKE_PROFIT,
        reason: ExitReason.of(`固定利確（${this.takeProfitPips}pips）`),
      });
    }

    return DoNothing.instance;
  }
}
