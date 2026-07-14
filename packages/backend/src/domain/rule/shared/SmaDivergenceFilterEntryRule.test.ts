import { describe, it, expect } from 'vitest';
import { SmaDivergenceFilterEntryRule } from './SmaDivergenceFilterEntryRule.js';
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
import type { BuySell } from '../../market/BuySell.js';

const now = new Date('2026-03-30T10:00:00Z');

function makeSnapshot(sma20Value: string, bid: string): MarketSnapshot {
  const sma = SmaSnapshot.of({
    shortSma: SmaValue.of(sma20Value), longSma: SmaValue.of('150'),
    previousShortSma: SmaValue.of(sma20Value), previousLongSma: SmaValue.of('150'),
  });
  const defaultSma = SmaSnapshot.of({
    shortSma: SmaValue.of('150'), longSma: SmaValue.of('150'),
    previousShortSma: SmaValue.of('150'), previousLongSma: SmaValue.of('150'),
  });
  const bidPrice = Price.of(bid);
  const askPrice = Price.of((parseFloat(bid) + 0.005).toFixed(3));
  const tick = Tick.of(askPrice, bidPrice, TickTimestamp.of(now));
  const tfMap = new Map<TimeFrame, TimeFrameSnapshot>();
  for (const tf of LIVE_TIMEFRAMES) {
    const tfSma = tf === TimeFrame.FIFTEEN_MINUTE ? sma : defaultSma;
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

class StubEntryRule implements EntryRule {
  constructor(private readonly result: 'BUY' | 'SELL' | 'NOTHING') {}
  shouldEntry(): EntryCommand | DoNothing {
    if (this.result === 'NOTHING') return DoNothing.instance;
    const side: BuySell = this.result;
    return EntryCommand.of({
      pair: CurrencyPair('USD_JPY'), buySell: side, lot: Lot.of(1000),
      reason: EntryReason.of('テスト'), convictionScore: ConvictionScore.of('0.7'),
      strategyName: StrategyName.SMA_CROSS,
      entrySnapshot: EntrySnapshot.of({ convictionScore: '0.7', entryHour: 10, entryDayOfWeek: 1 }),
      requiredMargin: Money.jpy('6000'),
    });
  }
}

describe('SmaDivergenceFilterEntryRule', () => {
  it('maxDivergencePct が負だと生成時にエラー', () => {
    expect(() => new SmaDivergenceFilterEntryRule(
      new StubEntryRule('BUY'), TimeFrame.FIFTEEN_MINUTE, -0.1,
    )).toThrow(/maxDivergencePct/);
  });

  it('inner が DoNothing なら何もせず DoNothing を返す（SMA 参照しない）', () => {
    const rule = new SmaDivergenceFilterEntryRule(
      new StubEntryRule('NOTHING'), TimeFrame.FIFTEEN_MINUTE, 0.2,
    );
    // どんな snapshot でも結果は DoNothing
    expect(rule.shouldEntry(makeSnapshot('150', '200'))).toBe(DoNothing.instance);
  });

  it('BUY で順方向（上向き）乖離が閾値超えなら DoNothing', () => {
    // SMA20 = 150.000, price = 150.400 → 乖離率 = 0.2667% > 0.2%
    const rule = new SmaDivergenceFilterEntryRule(
      new StubEntryRule('BUY'), TimeFrame.FIFTEEN_MINUTE, 0.2,
    );
    expect(rule.shouldEntry(makeSnapshot('150.000', '150.400'))).toBe(DoNothing.instance);
  });

  it('BUY で順方向乖離が閾値以下なら inner へ委譲', () => {
    // SMA20 = 150.000, price = 150.100 → 乖離率 = 0.0667% < 0.2%
    const rule = new SmaDivergenceFilterEntryRule(
      new StubEntryRule('BUY'), TimeFrame.FIFTEEN_MINUTE, 0.2,
    );
    expect(rule.shouldEntry(makeSnapshot('150.000', '150.100'))).toBeInstanceOf(EntryCommand);
  });

  it('BUY で逆方向（下向き）乖離がどれだけ大きくても inner へ委譲（非対称）', () => {
    // SMA20 = 150.000, price = 149.000 → 順方向乖離率 = -0.667%（上限 0.2% を超えない）
    const rule = new SmaDivergenceFilterEntryRule(
      new StubEntryRule('BUY'), TimeFrame.FIFTEEN_MINUTE, 0.2,
    );
    expect(rule.shouldEntry(makeSnapshot('150.000', '149.000'))).toBeInstanceOf(EntryCommand);
  });

  it('SELL で順方向（下向き）乖離が閾値超えなら DoNothing', () => {
    // SMA20 = 150.000, price = 149.600 → 順方向乖離率 = 0.2667% > 0.2%
    const rule = new SmaDivergenceFilterEntryRule(
      new StubEntryRule('SELL'), TimeFrame.FIFTEEN_MINUTE, 0.2,
    );
    expect(rule.shouldEntry(makeSnapshot('150.000', '149.600'))).toBe(DoNothing.instance);
  });

  it('SELL で順方向乖離が閾値以下なら inner へ委譲', () => {
    // SMA20 = 150.000, price = 149.900 → 順方向乖離率 = 0.0667% < 0.2%
    const rule = new SmaDivergenceFilterEntryRule(
      new StubEntryRule('SELL'), TimeFrame.FIFTEEN_MINUTE, 0.2,
    );
    expect(rule.shouldEntry(makeSnapshot('150.000', '149.900'))).toBeInstanceOf(EntryCommand);
  });

  it('SELL で逆方向（上向き）乖離がどれだけ大きくても inner へ委譲（非対称）', () => {
    // SMA20 = 150.000, price = 151.000 → 順方向乖離率 = -0.667%（上限 0.2% を超えない）
    const rule = new SmaDivergenceFilterEntryRule(
      new StubEntryRule('SELL'), TimeFrame.FIFTEEN_MINUTE, 0.2,
    );
    expect(rule.shouldEntry(makeSnapshot('150.000', '151.000'))).toBeInstanceOf(EntryCommand);
  });

  it('maxDivergencePct = 0 でも順方向乖離が 0 以下なら inner へ委譲（境界は以上で許可）', () => {
    // SMA20 = 150.000, price = 150.000 → 乖離率 = 0.0% > 0.0% は false なので inner
    const rule = new SmaDivergenceFilterEntryRule(
      new StubEntryRule('BUY'), TimeFrame.FIFTEEN_MINUTE, 0.0,
    );
    expect(rule.shouldEntry(makeSnapshot('150.000', '150.000'))).toBeInstanceOf(EntryCommand);
  });
});
