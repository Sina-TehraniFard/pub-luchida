import Big from 'big.js';
import type { EntryRule } from '../EntryRule.js';
import type { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import type { EntryCommand } from '../../command/EntryCommand.js';
import { DoNothing } from '../../command/DoNothing.js';
import { pipUnit } from '../../market/CurrencyPair.js';
import type { TimeFrame } from '../../market/TimeFrame.js';

/**
 * SMA クロス強度フィルター（EntryRule デコレータ）。
 *
 * 確定足 SMA スナップショットから「1 bar での短期・長期 SMA の乖離変化量（pips/bar）」を算出し、
 * 閾値未満なら inner rule を呼ばずに DoNothing を返す。
 *
 * 乖離変化 = (短期 - 長期) の 1 bar 増分。
 *   - ゴールデンクロスが「急に」成立した場合: 大きな正の値（強い上昇圧）
 *   - デッドクロスが「急に」成立した場合: 大きな負の値（強い下降圧）
 *   - 弱いクロス（SMA がほぼ水平で僅かに交差した場合）: 小さな値 → フェイクの可能性高
 *
 * 絶対値での判定なので、方向（BUY/SELL）は inner rule が決定する。
 *
 * コンストラクタ:
 * - inner: ベースとなる EntryRule（例: SmaCrossEntryRule）
 * - timeFrame: SMA を評価する時間足
 * - minStrengthPips: 許容する最小のクロス強度（pips/bar）。これ未満の bar では inner を呼ばない
 */
export class CrossStrengthFilterEntryRule implements EntryRule {
  constructor(
    private readonly inner: EntryRule,
    private readonly timeFrame: TimeFrame,
    private readonly minStrengthPips: number,
  ) {
    if (minStrengthPips < 0) {
      throw new Error(`minStrengthPips は 0 以上である必要があります: ${minStrengthPips}`);
    }
  }

  shouldEntry(snapshot: MarketSnapshot): EntryCommand | DoNothing {
    const tf = snapshot.snapshotOf(this.timeFrame);
    const sma = tf.indicators.confirmed;
    const unit = pipUnit(snapshot.pair);

    // 1 bar での「短期 - 長期」の増分（絶対値、単位 pips）
    const curShort = new Big(sma.shortSma.toString());
    const curLong = new Big(sma.longSma.toString());
    const prevShort = new Big(sma.previousShortSma.toString());
    const prevLong = new Big(sma.previousLongSma.toString());
    const currentDiff = curShort.minus(curLong);
    const prevDiff = prevShort.minus(prevLong);
    const strength = currentDiff.minus(prevDiff).abs().div(unit).toNumber();

    if (strength < this.minStrengthPips) {
      return DoNothing.instance;
    }
    return this.inner.shouldEntry(snapshot);
  }
}
