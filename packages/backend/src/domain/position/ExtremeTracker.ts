import { Price } from '../market/Price.js';
import { BuySell } from '../market/BuySell.js';
import type { ExtremesSnapshot } from './ExtremesSnapshot.js';

/**
 * ポジション保有中の最高値/最安値をインメモリで追跡する。
 * 決済時に Position.applyExtremes() で MFE/MAE を確定させる。
 *
 * プロセス再起動時は追跡データが失われるが、
 * 再起動後の最初の tick から再追跡を開始する。
 */
export class ExtremeTracker {
  private readonly tracking = new Map<string, ExtremesSnapshot>();

  /**
   * 指定ポジションの極値を現在の価格で更新する。
   * BUY → bid（売り決済価格）で追跡、SELL → ask（買い決済価格）で追跡。
   */
  update(positionId: string, bid: Price, ask: Price, buySell: BuySell): void {
    const price = buySell === 'BUY' ? bid : ask;
    const existing = this.tracking.get(positionId);

    if (!existing) {
      this.tracking.set(positionId, { highest: price, lowest: price });
      return;
    }

    const updated: ExtremesSnapshot = {
      highest: price.isHigherThan(existing.highest) ? price : existing.highest,
      lowest: existing.lowest.isHigherThan(price) ? price : existing.lowest,
    };
    this.tracking.set(positionId, updated);
  }

  get(positionId: string): ExtremesSnapshot | undefined {
    return this.tracking.get(positionId);
  }

  /**
   * OHLC モード用。BUY/SELL に依存せず highest と lowest を独立に追跡する。
   * tick モードの update() とは異なり、足の high/low の両方を記録する。
   */
  updateOhlc(positionId: string, high: Price, low: Price): void {
    const existing = this.tracking.get(positionId);
    if (!existing) {
      this.tracking.set(positionId, { highest: high, lowest: low });
      return;
    }
    this.tracking.set(positionId, {
      highest: high.isHigherThan(existing.highest) ? high : existing.highest,
      lowest: existing.lowest.isHigherThan(low) ? low : existing.lowest,
    });
  }

  remove(positionId: string): void {
    this.tracking.delete(positionId);
  }
}
