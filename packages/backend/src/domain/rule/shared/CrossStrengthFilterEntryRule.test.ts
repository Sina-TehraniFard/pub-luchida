import { describe, it, expect } from 'vitest';
import { CrossStrengthFilterEntryRule } from './CrossStrengthFilterEntryRule.js';
import { DoNothing } from '../../command/DoNothing.js';
import { EntryCommand } from '../../command/EntryCommand.js';
import type { EntryRule } from '../EntryRule.js';
import { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import { TimeFrameSnapshot } from '../../market/snapshot/TimeFrameSnapshot.js';
import { IndicatorValues } from '../../market/indicator/IndicatorValues.js';
import { SmaSnapshot } from '../../market/indicator/SmaSnapshot.js';
import { SmaValue } from '../../market/indicator/SmaValue.js';
import { ConfirmedCandle } from '../../market/candle/ConfirmedCandle.js';
import { FormingCandle } from '../../market/candle/FormingCandle.js';
import { CandleOpenTime } from '../../market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '../../market/candle/CandleCloseTime.js';
import { Price } from '../../market/Price.js';
import { Tick } from '../../market/tick/Tick.js';
import { TickTimestamp } from '../../market/tick/TickTimestamp.js';
import { Timestamp } from '../../market/Timestamp.js';
import { CurrencyPair } from '../../market/CurrencyPair.js';
import { TimeFrame, LIVE_TIMEFRAMES } from '../../market/TimeFrame.js';
import { EntryReason } from '../../command/EntryReason.js';
import { ConvictionScore } from '../../market/ConvictionScore.js';
import { Lot } from '../../position/Lot.js';
import { StrategyName } from '../StrategyName.js';
import { EntrySnapshot } from '../../market/snapshot/EntrySnapshot.js';
import { Money } from '../../Money.js';

const now = new Date('2026-03-30T10:00:00Z');

function makeSma(curShort: string, curLong: string, prevShort: string, prevLong: string): SmaSnapshot {
  return SmaSnapshot.of({
    shortSma: SmaValue.of(curShort), longSma: SmaValue.of(curLong),
    previousShortSma: SmaValue.of(prevShort), previousLongSma: SmaValue.of(prevLong),
  });
}

function makeSnapshot(sma: SmaSnapshot): MarketSnapshot {
  const tfMap = new Map<TimeFrame, TimeFrameSnapshot>();
  const tick = Tick.of(Price.of('150.5'), Price.of('150.495'), TickTimestamp.of(now));
  for (const tf of LIVE_TIMEFRAMES) {
    const tfSma = tf === TimeFrame.FIFTEEN_MINUTE ? sma : makeSma('150', '150', '150', '150');
    tfMap.set(tf, TimeFrameSnapshot.of({
      timeFrame: tf,
      confirmed: ConfirmedCandle.of({
        open: Price.of('150'), high: Price.of('151'), low: Price.of('149'), close: Price.of('150'),
        openTime: CandleOpenTime.of(new Date(now.getTime() - 60000)),
        closeTime: CandleCloseTime.of(new Date(now.getTime() - 1)),
        timeFrame: tf,
      }),
      forming: FormingCandle.open(tick, tf),
      indicators: IndicatorValues.of(tfSma, tfSma),
    }));
  }
  return MarketSnapshot.of({
    timeFrames: tfMap, tick, pair: CurrencyPair('USD_JPY'), capturedAt: Timestamp.of(now),
  });
}

class AlwaysEntryRule implements EntryRule {
  shouldEntry(): EntryCommand | DoNothing {
    return EntryCommand.of({
      pair: CurrencyPair('USD_JPY'), buySell: 'BUY', lot: Lot.of(1000),
      reason: EntryReason.of('テスト'), convictionScore: ConvictionScore.of('0.7'),
      strategyName: StrategyName.SMA_CROSS,
      entrySnapshot: EntrySnapshot.of({ convictionScore: '0.7', entryHour: 10, entryDayOfWeek: 1 }),
      requiredMargin: Money.jpy('6000'),
    });
  }
}

describe('CrossStrengthFilterEntryRule', () => {
  it('minStrengthPips が負だと生成時にエラー', () => {
    expect(() => new CrossStrengthFilterEntryRule(new AlwaysEntryRule(), TimeFrame.FIFTEEN_MINUTE, -1)).toThrow(/minStrengthPips/);
  });

  it('minStrengthPips = 0 ならフィルターなし（常に inner へ委譲）', () => {
    const rule = new CrossStrengthFilterEntryRule(new AlwaysEntryRule(), TimeFrame.FIFTEEN_MINUTE, 0);
    // 変化ゼロでも inner へ委譲
    const sma = makeSma('150.0', '150.0', '150.0', '150.0');
    const result = rule.shouldEntry(makeSnapshot(sma));
    expect(result).toBeInstanceOf(EntryCommand);
  });

  it('強度が閾値未満なら DoNothing', () => {
    // 乖離変化 = (150.02 - 150.01) - (150.01 - 150.00) = 0.001 yen = 0.1 pip
    const sma = makeSma('150.02', '150.01', '150.01', '150.00');
    const rule = new CrossStrengthFilterEntryRule(new AlwaysEntryRule(), TimeFrame.FIFTEEN_MINUTE, 1);
    expect(rule.shouldEntry(makeSnapshot(sma))).toBe(DoNothing.instance);
  });

  it('強度が閾値以上なら inner へ委譲', () => {
    // 乖離変化 = (150.10 - 150.00) - (149.90 - 150.00) = 0.20 yen = 20 pips
    const sma = makeSma('150.10', '150.00', '149.90', '150.00');
    const rule = new CrossStrengthFilterEntryRule(new AlwaysEntryRule(), TimeFrame.FIFTEEN_MINUTE, 10);
    expect(rule.shouldEntry(makeSnapshot(sma))).toBeInstanceOf(EntryCommand);
  });

  it('乖離が縮小する方向（反クロス）でも絶対値で判定', () => {
    // prevDiff = +0.20（short が上）、currentDiff = -0.10（デッドクロス成立）
    // 変化量 = -0.10 - 0.20 = -0.30 → abs 30 pips
    const sma = makeSma('150.00', '150.10', '150.20', '150.00');
    const rule = new CrossStrengthFilterEntryRule(new AlwaysEntryRule(), TimeFrame.FIFTEEN_MINUTE, 20);
    expect(rule.shouldEntry(makeSnapshot(sma))).toBeInstanceOf(EntryCommand);
  });

  it('閾値ちょうどなら inner へ委譲（境界は以上で許可）', () => {
    // 変化量 = 10 pips, 閾値 = 10
    const sma = makeSma('150.10', '150.00', '150.00', '150.00');
    const rule = new CrossStrengthFilterEntryRule(new AlwaysEntryRule(), TimeFrame.FIFTEEN_MINUTE, 10);
    expect(rule.shouldEntry(makeSnapshot(sma))).toBeInstanceOf(EntryCommand);
  });
});
