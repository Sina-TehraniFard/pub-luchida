import { describe, it, expect } from 'vitest';
import { TimeWindowBlockEntryRule, type TimeWindow } from './TimeWindowBlockEntryRule.js';
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

function makeSnapshot(time: Date): MarketSnapshot {
  const tfMap = new Map<TimeFrame, TimeFrameSnapshot>();
  const sma = SmaSnapshot.of({
    shortSma: SmaValue.of('150'), longSma: SmaValue.of('150'),
    previousShortSma: SmaValue.of('150'), previousLongSma: SmaValue.of('150'),
  });
  const tick = Tick.of(Price.of('150.5'), Price.of('150.495'), TickTimestamp.of(time));
  for (const tf of LIVE_TIMEFRAMES) {
    tfMap.set(tf, TimeFrameSnapshot.of({
      timeFrame: tf,
      confirmed: ConfirmedCandle.of({
        open: Price.of('150'), high: Price.of('151'), low: Price.of('149'), close: Price.of('150'),
        openTime: CandleOpenTime.of(new Date(time.getTime() - 60000)),
        closeTime: CandleCloseTime.of(new Date(time.getTime() - 1)),
        timeFrame: tf,
      }),
      forming: FormingCandle.open(tick, tf),
      indicators: IndicatorValues.of(sma, sma),
    }));
  }
  return MarketSnapshot.of({
    timeFrames: tfMap, tick, pair: CurrencyPair('USD_JPY'), capturedAt: Timestamp.of(time),
  });
}

class AlwaysEntryRule implements EntryRule {
  shouldEntry(): EntryCommand | DoNothing {
    return EntryCommand.of({
      pair: CurrencyPair('USD_JPY'), buySell: 'BUY', lot: Lot.of(1000),
      reason: EntryReason.of('test'), convictionScore: ConvictionScore.of('0.7'),
      strategyName: StrategyName.SMA_CROSS,
      entrySnapshot: EntrySnapshot.of({ convictionScore: '0.7', entryHour: 10, entryDayOfWeek: 1 }),
      requiredMargin: Money.jpy('6000'),
    });
  }
}

describe('TimeWindowBlockEntryRule', () => {
  const base = new AlwaysEntryRule();
  const anyTime = new Date('2024-05-01T12:00:00Z');

  it('windows が空なら常に inner へ委譲', () => {
    const rule = new TimeWindowBlockEntryRule(base, []);
    expect(rule.shouldEntry(makeSnapshot(anyTime))).toBeInstanceOf(EntryCommand);
  });

  it('全ての window が match しないなら inner へ委譲', () => {
    const neverMatch: TimeWindow = { label: 'never', matches: () => false };
    const rule = new TimeWindowBlockEntryRule(base, [neverMatch]);
    expect(rule.shouldEntry(makeSnapshot(anyTime))).toBeInstanceOf(EntryCommand);
  });

  it('どれかの window が match すれば DoNothing', () => {
    const alwaysMatch: TimeWindow = { label: 'always', matches: () => true };
    const rule = new TimeWindowBlockEntryRule(base, [alwaysMatch]);
    expect(rule.shouldEntry(makeSnapshot(anyTime))).toBe(DoNothing.instance);
  });

  it('複数 window のうち 1 つでも match すれば DoNothing（OR 合成）', () => {
    const matchA: TimeWindow = { label: 'A', matches: () => false };
    const matchB: TimeWindow = { label: 'B', matches: () => true };
    const rule = new TimeWindowBlockEntryRule(base, [matchA, matchB]);
    expect(rule.shouldEntry(makeSnapshot(anyTime))).toBe(DoNothing.instance);
  });

  it('window の matches に渡される Date は snapshot.capturedAt の UTC Date', () => {
    let received: Date | null = null;
    const capture: TimeWindow = {
      label: 'capture',
      matches: (t) => { received = t; return false; },
    };
    const rule = new TimeWindowBlockEntryRule(base, [capture]);
    rule.shouldEntry(makeSnapshot(anyTime));
    expect(received).not.toBeNull();
    expect(received!.getTime()).toBe(anyTime.getTime());
  });
});
