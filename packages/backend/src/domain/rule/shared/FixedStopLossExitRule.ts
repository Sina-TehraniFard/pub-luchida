import Big from 'big.js';
import type { ExitRule } from '../ExitRule.js';
import { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import { Position } from '../../position/Position.js';
import { ExitCommand, ExitType } from '../../command/ExitCommand.js';
import { DoNothing } from '../../command/DoNothing.js';
import { ExitReason } from '../../command/ExitReason.js';
import { pipUnit } from '../../market/CurrencyPair.js';

/**
 * 固定ストップロスによる決済判定。
 * エントリー価格から指定 pips 逆行したら損切りする。
 * BUY ポジション → bid（売り決済価格）で判定
 * SELL ポジション → ask（買い決済価格）で判定
 */
export class FixedStopLossExitRule implements ExitRule {
  private readonly stopLossPips: number;

  constructor(stopLossPips: number = 15) {
    this.stopLossPips = stopLossPips;
  }

  shouldExit(snapshot: MarketSnapshot, position: Position): ExitCommand | DoNothing {
    // 決済時の約定価格で判定: BUY → bid で売り決済、SELL → ask で買い決済
    const currentPrice = position.buySell === 'BUY'
      ? snapshot.tick.bid()
      : snapshot.tick.ask();

    const currentBig = currentPrice.toBig();
    const entryBig = position.entryPrice.toBig();

    // 逆行幅を計算（円）
    const adverseMove = position.buySell === 'BUY'
      ? entryBig.minus(currentBig)
      : currentBig.minus(entryBig);

    // pips換算（通貨ペアに応じた pip 単位）
    const unit = pipUnit(snapshot.pair);
    const stopLossThreshold = new Big(this.stopLossPips).times(unit);

    if (adverseMove.gte(stopLossThreshold)) {
      return ExitCommand.of({
        positionId: position.id,
        type: ExitType.STOP_LOSS,
        reason: ExitReason.of(`固定ストップロス（${this.stopLossPips}pips）`),
      });
    }

    return DoNothing.instance;
  }
}
