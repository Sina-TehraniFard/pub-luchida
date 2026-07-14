import Big from 'big.js';
import type { EntryRule } from '../EntryRule.js';
import type { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import { EntryCommand } from '../../command/EntryCommand.js';
import { DoNothing } from '../../command/DoNothing.js';
import type { TimeFrame } from '../../market/TimeFrame.js';

/**
 * 価格-SMA20 乖離フィルター（EntryRule デコレータ／方向別）。
 *
 * inner rule が EntryCommand を返したときのみ、その方向に対して「順方向への過剰乖離」を弾く。
 * - BUY:  price が SMA20 の上側に maxDivergencePct 超え乖離していたら高値掴みと判断し DoNothing
 * - SELL: price が SMA20 の下側に maxDivergencePct 超え乖離していたら底値売りと判断し DoNothing
 *
 * 逆方向（BUY で price < SMA20、SELL で price > SMA20）は弾かない。
 * これによりトレンドの利益源は残しつつ、走り切った後の飛びつきエントリーだけを排除する。
 *
 * コンストラクタ:
 * - inner: ベースとなる EntryRule（例: SmaCrossEntryRule）
 * - timeFrame: SMA20 を評価する時間足
 * - maxDivergencePct: 許容する順方向乖離率の上限（%）。例: 0.2 = 0.2%
 */
export class SmaDivergenceFilterEntryRule implements EntryRule {
  constructor(
    private readonly inner: EntryRule,
    private readonly timeFrame: TimeFrame,
    private readonly maxDivergencePct: number,
  ) {
    if (maxDivergencePct < 0) {
      throw new Error(`maxDivergencePct は 0 以上である必要があります: ${maxDivergencePct}`);
    }
  }

  shouldEntry(snapshot: MarketSnapshot): EntryCommand | DoNothing {
    const result = this.inner.shouldEntry(snapshot);
    if (!(result instanceof EntryCommand)) {
      return result;
    }

    const tf = snapshot.snapshotOf(this.timeFrame);
    const sma20 = new Big(tf.indicators.confirmed.shortSma.toString());
    const price = new Big(snapshot.tick.bid().toString());

    // 順方向乖離率（%）: BUY なら (price - SMA20) / SMA20、SELL なら (SMA20 - price) / SMA20
    const diff = result.buySell === 'BUY'
      ? price.minus(sma20)
      : sma20.minus(price);
    const divergencePct = diff.div(sma20).times(100).toNumber();

    if (divergencePct > this.maxDivergencePct) {
      return DoNothing.instance;
    }
    return result;
  }
}
