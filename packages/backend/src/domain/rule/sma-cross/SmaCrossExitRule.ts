import type { ExitRule } from '../ExitRule.js';
import { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import { Position } from '../../position/Position.js';
import { ExitCommand, ExitType } from '../../command/ExitCommand.js';
import { DoNothing } from '../../command/DoNothing.js';
import { ExitReason } from '../../command/ExitReason.js';
import { TimeFrame } from '../../market/TimeFrame.js';
import { detectCross } from './SmaCrossSignal.js';

/**
 * SMA クロスによる決済判定。
 *
 * BUY ポジション: デッドクロス発生 → 決済（利確 or 損切りはエントリー価格との比較で判定）
 * SELL ポジション: ゴールデンクロス発生 → 決済
 *
 * コンストラクタで指定した時間足の確定足SMAで判定する。
 */
export class SmaCrossExitRule implements ExitRule {
  constructor(private readonly timeFrame: TimeFrame) {}

  shouldExit(snapshot: MarketSnapshot, position: Position): ExitCommand | DoNothing {
    const tf = snapshot.snapshotOf(this.timeFrame);
    const sma = tf.indicators.confirmed;
    const cross = detectCross(sma);

    // BUY ポジション → デッドクロスで決済
    if (position.buySell === 'BUY' && cross === 'DEAD_CROSS') {
      return this.buildExitCommand(snapshot, position, 'SMA デッドクロス（BUYポジション決済）');
    }

    // SELL ポジション → ゴールデンクロスで決済
    if (position.buySell === 'SELL' && cross === 'GOLDEN_CROSS') {
      return this.buildExitCommand(snapshot, position, 'SMA ゴールデンクロス（SELLポジション決済）');
    }

    return DoNothing.instance;
  }

  private buildExitCommand(
    snapshot: MarketSnapshot,
    position: Position,
    reasonText: string,
  ): ExitCommand {
    const currentPrice = snapshot.tick.midPrice();
    const isProfit =
      position.buySell === 'BUY'
        ? currentPrice.isHigherThan(position.entryPrice)
        : position.entryPrice.isHigherThan(currentPrice);

    return ExitCommand.of({
      positionId: position.id,
      type: isProfit ? ExitType.TAKE_PROFIT : ExitType.STOP_LOSS,
      reason: ExitReason.of(reasonText),
    });
  }
}
