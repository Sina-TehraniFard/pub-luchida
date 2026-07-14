import type { EntryRule } from '../EntryRule.js';
import { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import { EntryCommand } from '../../command/EntryCommand.js';
import { DoNothing } from '../../command/DoNothing.js';
import { EntryReason } from '../../command/EntryReason.js';
import { ConvictionScore } from '../../market/ConvictionScore.js';
import { EntrySnapshot } from '../../market/snapshot/EntrySnapshot.js';
import type { SizingResultLike } from '../../position/SizingResultLike.js';
import { TimeFrame } from '../../market/TimeFrame.js';
import { StrategyName } from '../StrategyName.js';
import { pipUnit } from '../../market/CurrencyPair.js';
import { detectCross } from './SmaCrossSignal.js';

/**
 * SMA クロスによるエントリー判定。
 *
 * ゴールデンクロス（短期SMAが長期SMAを下から上に抜けた）→ BUY
 * デッドクロス（短期SMAが長期SMAを上から下に抜けた）→ SELL
 *
 * 15分足の確定足SMA(20/100)で判定する。
 * ロットは口座残高から自動計算（1万円につき1,000通貨）。
 *
 * `getSizing` は `SizingResultLike` を返す closure。
 * 本番経路: `PositionSizingService.executeSizing(pair)` → `SizingResult` を返す
 * バックテスト経路: `BacktestSizingResult.of(lot, pair)` を返す closure を渡す
 * `EntryCommand.requiredMargin` は `SizingResultLike.requiredMargin()` から流用する
 * （policies.md 3.3.1 P10 確定 / NH-2 rate 二重取得回避）。
 * 将来 `PositionManager` 導入時には Rule から Lot 計算を引き剥がす（Step 10）。
 */
export class SmaCrossEntryRule implements EntryRule {
  constructor(
    private readonly timeFrame: TimeFrame,
    private readonly getSizing: () => SizingResultLike,
  ) {}

  // 判定根拠（確定 SMA の実値）のログは TimeFrameBook の足確定イベントが担う。
  // Rule 側でログするとフィルタチェーンの短絡（時間帯除外・クロス強度等）で
  // 証跡が歯抜けになるため、ここではログしない（#65 の教訓）。
  shouldEntry(snapshot: MarketSnapshot): EntryCommand | DoNothing {
    const tf = snapshot.snapshotOf(this.timeFrame);
    const sma = tf.indicators.confirmed;
    const cross = detectCross(sma);
    const tfLabel = `${this.timeFrame}`;

    if (cross === 'GOLDEN_CROSS') {
      const sizing = this.getSizing();
      return EntryCommand.of({
        pair: snapshot.pair,
        buySell: 'BUY',
        lot: sizing.lot(),
        reason: EntryReason.of(`SMA ゴールデンクロス（${tfLabel}）`),
        convictionScore: ConvictionScore.of('0.7'),
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: this.buildSnapshot(snapshot, '0.7'),
        requiredMargin: sizing.requiredMargin(),
      });
    }

    if (cross === 'DEAD_CROSS') {
      const sizing = this.getSizing();
      return EntryCommand.of({
        pair: snapshot.pair,
        buySell: 'SELL',
        lot: sizing.lot(),
        reason: EntryReason.of(`SMA デッドクロス（${tfLabel}）`),
        convictionScore: ConvictionScore.of('0.7'),
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: this.buildSnapshot(snapshot, '0.7'),
        requiredMargin: sizing.requiredMargin(),
      });
    }

    return DoNothing.instance;
  }

  private buildSnapshot(snapshot: MarketSnapshot, conviction: string): EntrySnapshot {
    const unit = pipUnit(snapshot.pair);
    const spreadPips = snapshot.tick.spread().value().toBig().div(unit).toFixed(4);
    const capturedAt = snapshot.capturedAt.toDate();
    return EntrySnapshot.of({
      convictionScore: conviction,
      spreadPips,
      entryHour: capturedAt.getUTCHours(),
      entryDayOfWeek: capturedAt.getUTCDay(),
    });
  }
}
