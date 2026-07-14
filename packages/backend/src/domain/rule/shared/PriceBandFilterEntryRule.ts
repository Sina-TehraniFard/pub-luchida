import type { EntryRule } from '../EntryRule.js';
import type { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import { EntryCommand } from '../../command/EntryCommand.js';
import { DoNothing } from '../../command/DoNothing.js';

/**
 * 価格帯フィルター（EntryRule デコレータ）。
 *
 * 現在価格が指定した帯外のときエントリーを見送る。
 * 「過去最安値圏での順張り SELL は介入リスクが構造的に高い」等の
 * マーケットメーカー視点の設計判断をルール化する。
 *
 * - minSellPrice が指定されていて、価格 < minSellPrice の場合: SELL を block
 * - maxBuyPrice が指定されていて、価格 > maxBuyPrice の場合: BUY を block
 *
 * どちらか一方だけの指定も可能（もう片方は null）。
 * 評価は tick の mid（(bid+ask)/2）で行う。
 */
export class PriceBandFilterEntryRule implements EntryRule {
  constructor(
    private readonly inner: EntryRule,
    private readonly minSellPrice: number | null,
    private readonly maxBuyPrice: number | null,
  ) {
    if (minSellPrice === null && maxBuyPrice === null) {
      throw new Error('minSellPrice と maxBuyPrice のうち少なくとも 1 つを指定する必要があります');
    }
    if (minSellPrice !== null && minSellPrice <= 0) {
      throw new Error(`minSellPrice は正の値: ${minSellPrice}`);
    }
    if (maxBuyPrice !== null && maxBuyPrice <= 0) {
      throw new Error(`maxBuyPrice は正の値: ${maxBuyPrice}`);
    }
  }

  shouldEntry(snapshot: MarketSnapshot): EntryCommand | DoNothing {
    const result = this.inner.shouldEntry(snapshot);
    if (!(result instanceof EntryCommand)) return result;

    const bid = parseFloat(snapshot.tick.bid().toString());
    const ask = parseFloat(snapshot.tick.ask().toString());
    const mid = (bid + ask) / 2;

    if (result.buySell === 'SELL' && this.minSellPrice !== null && mid < this.minSellPrice) {
      return DoNothing.instance;
    }
    if (result.buySell === 'BUY' && this.maxBuyPrice !== null && mid > this.maxBuyPrice) {
      return DoNothing.instance;
    }

    return result;
  }
}
