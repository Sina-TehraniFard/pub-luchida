import type { ExitRule } from '../ExitRule.js';
import { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import { Position } from '../../position/Position.js';
import { ExitCommand, ExitType } from '../../command/ExitCommand.js';
import { DoNothing } from '../../command/DoNothing.js';
import { ExitReason } from '../../command/ExitReason.js';
import { pipUnit } from '../../market/CurrencyPair.js';

/**
 * トレーリング利確による決済判定。
 *
 * MFE が activatePips に到達したらトレーリングを開始する。
 * 以降、含み益が「過去最高 - trailWidthPips」を下回ったら利確する。
 *
 * 例: activatePips=150, trailWidthPips=70
 *   MFE が 150pips に到達 → トレーリング開始
 *   MFE が 200pips まで伸びる → ストップは 130pips
 *   含み益が 130pips に戻る → 130pips で利確
 *
 * ポジションごとに MFE を追跡するため、内部に状態を持つ。
 * ポジション決済後は自動的に追跡が終了する（次のポジションは別 ID）。
 */
export class TrailingTakeProfitExitRule implements ExitRule {
  private readonly peakPnl = new Map<string, number>();

  constructor(
    private readonly activatePips: number,
    private readonly trailWidthPips: number,
  ) {}

  shouldExit(snapshot: MarketSnapshot, position: Position): ExitCommand | DoNothing {
    const posId = position.id.toString();
    const currentPrice = position.buySell === 'BUY'
      ? snapshot.tick.bid()
      : snapshot.tick.ask();

    const unit = pipUnit(snapshot.pair);
    const currentBig = currentPrice.toBig();
    const entryBig = position.entryPrice.toBig();

    const favorableMove = position.buySell === 'BUY'
      ? currentBig.minus(entryBig)
      : entryBig.minus(currentBig);

    const currentPips = favorableMove.div(unit).toNumber();

    // MFE を更新
    const prevPeak = this.peakPnl.get(posId) ?? 0;
    const newPeak = Math.max(prevPeak, currentPips);
    this.peakPnl.set(posId, newPeak);

    // トレーリング起動判定
    if (newPeak < this.activatePips) {
      return DoNothing.instance;
    }

    // トレーリングストップ: MFE - trailWidth を下回ったら利確
    const trailStop = newPeak - this.trailWidthPips;
    if (currentPips <= trailStop) {
      this.peakPnl.delete(posId);
      return ExitCommand.of({
        positionId: position.id,
        type: ExitType.TAKE_PROFIT,
        reason: ExitReason.of(
          `トレーリング利確（MFE${Math.round(newPeak)}pips, 幅${this.trailWidthPips}pips, 決済${Math.round(currentPips)}pips）`,
        ),
      });
    }

    return DoNothing.instance;
  }

  /**
   * ポジション決済時にクリーンアップする。
   * TradingSession.evaluateExit で決済後に呼ぶ。
   */
  clearPosition(positionId: string): void {
    this.peakPnl.delete(positionId);
  }
}
