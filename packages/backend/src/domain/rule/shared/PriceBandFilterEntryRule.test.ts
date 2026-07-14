import { describe, it, expect } from 'vitest';
import { PriceBandFilterEntryRule } from './PriceBandFilterEntryRule.js';
import { DoNothing } from '../../command/DoNothing.js';
import { EntryCommand } from '../../command/EntryCommand.js';
import type { EntryRule } from '../EntryRule.js';
import type { BuySell } from '../../market/BuySell.js';
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

/** bid/ask で snapshot を組み立てる（mid は (bid+ask)/2）。 */
function snapshotAt(bid: string, ask: string): MarketSnapshot {
  const tick = Tick.of(Price.of(ask), Price.of(bid), TickTimestamp.of(now));
  const sma = SmaSnapshot.of({
    shortSma: SmaValue.of('150'), longSma: SmaValue.of('150'),
    previousShortSma: SmaValue.of('150'), previousLongSma: SmaValue.of('150'),
  });
  const tfMap = new Map<TimeFrame, TimeFrameSnapshot>();
  for (const tf of LIVE_TIMEFRAMES) {
    tfMap.set(tf, TimeFrameSnapshot.of({
      timeFrame: tf,
      confirmed: ConfirmedCandle.of({
        open: Price.of('150'), high: Price.of('151'), low: Price.of('149'), close: Price.of('150'),
        openTime: CandleOpenTime.of(new Date(now.getTime() - 60000)),
        closeTime: CandleCloseTime.of(new Date(now.getTime() - 1)),
        timeFrame: tf,
      }),
      forming: FormingCandle.open(tick, tf),
      indicators: IndicatorValues.of(sma, sma),
    }));
  }
  return MarketSnapshot.of({
    timeFrames: tfMap, tick, pair: CurrencyPair('USD_JPY'), capturedAt: Timestamp.of(now),
  });
}

class ConstantEntryRule implements EntryRule {
  constructor(private readonly side: BuySell) {}
  shouldEntry(): EntryCommand {
    return EntryCommand.of({
      pair: CurrencyPair('USD_JPY'), buySell: this.side, lot: Lot.of(1000),
      reason: EntryReason.of('テスト'), convictionScore: ConvictionScore.of('0.7'),
      strategyName: StrategyName.SMA_CROSS,
      entrySnapshot: EntrySnapshot.of({ convictionScore: '0.7', entryHour: 10, entryDayOfWeek: 1 }),
      requiredMargin: Money.jpy('6000'),
    });
  }
}

class AlwaysDoNothing implements EntryRule {
  shouldEntry(): DoNothing { return DoNothing.instance; }
}

describe('PriceBandFilterEntryRule', () => {
  describe('コンストラクタ', () => {
    it('両方 null だとエラー', () => {
      expect(() => new PriceBandFilterEntryRule(new ConstantEntryRule('BUY'), null, null)).toThrow(/少なくとも 1 つ/);
    });
    it('minSellPrice が 0 以下だとエラー', () => {
      expect(() => new PriceBandFilterEntryRule(new ConstantEntryRule('BUY'), 0, null)).toThrow(/minSellPrice/);
    });
    it('maxBuyPrice が 0 以下だとエラー', () => {
      expect(() => new PriceBandFilterEntryRule(new ConstantEntryRule('BUY'), null, -1)).toThrow(/maxBuyPrice/);
    });
  });

  describe('SELL 下限（minSellPrice）', () => {
    it('価格 < minSellPrice で SELL は block', () => {
      const rule = new PriceBandFilterEntryRule(new ConstantEntryRule('SELL'), 85, null);
      // mid = (84.9 + 84.91)/2 = 84.905 < 85 → block
      const result = rule.shouldEntry(snapshotAt('84.900', '84.910'));
      expect(result).toBe(DoNothing.instance);
    });
    it('価格 = minSellPrice ちょうどなら SELL 通す', () => {
      const rule = new PriceBandFilterEntryRule(new ConstantEntryRule('SELL'), 85, null);
      // mid = 85.000 → 85 以上なので通す
      const result = rule.shouldEntry(snapshotAt('84.995', '85.005'));
      expect(result).toBeInstanceOf(EntryCommand);
    });
    it('価格 > minSellPrice で SELL は通す', () => {
      const rule = new PriceBandFilterEntryRule(new ConstantEntryRule('SELL'), 85, null);
      const result = rule.shouldEntry(snapshotAt('89.995', '90.005'));
      expect(result).toBeInstanceOf(EntryCommand);
    });
    it('BUY は minSellPrice の影響を受けず、価格に関わらず通す', () => {
      const rule = new PriceBandFilterEntryRule(new ConstantEntryRule('BUY'), 85, null);
      // 低価格でも BUY は通す
      const result = rule.shouldEntry(snapshotAt('70.000', '70.010'));
      expect(result).toBeInstanceOf(EntryCommand);
    });
  });

  describe('BUY 上限（maxBuyPrice）', () => {
    it('価格 > maxBuyPrice で BUY は block', () => {
      const rule = new PriceBandFilterEntryRule(new ConstantEntryRule('BUY'), null, 160);
      // mid = 160.1 > 160 → block
      const result = rule.shouldEntry(snapshotAt('160.095', '160.105'));
      expect(result).toBe(DoNothing.instance);
    });
    it('価格 = maxBuyPrice ちょうどなら BUY 通す', () => {
      const rule = new PriceBandFilterEntryRule(new ConstantEntryRule('BUY'), null, 160);
      const result = rule.shouldEntry(snapshotAt('159.995', '160.005'));
      expect(result).toBeInstanceOf(EntryCommand);
    });
    it('SELL は maxBuyPrice の影響を受けず通す', () => {
      const rule = new PriceBandFilterEntryRule(new ConstantEntryRule('SELL'), null, 160);
      const result = rule.shouldEntry(snapshotAt('165.000', '165.010'));
      expect(result).toBeInstanceOf(EntryCommand);
    });
  });

  describe('両方指定', () => {
    it('SELL 下限と BUY 上限の両方が独立に作用する', () => {
      const rule = new PriceBandFilterEntryRule(new ConstantEntryRule('SELL'), 85, 160);
      // 70 円で SELL → block
      expect(rule.shouldEntry(snapshotAt('69.995', '70.005'))).toBe(DoNothing.instance);

      const buyRule = new PriceBandFilterEntryRule(new ConstantEntryRule('BUY'), 85, 160);
      // 165 円で BUY → block
      expect(buyRule.shouldEntry(snapshotAt('164.995', '165.005'))).toBe(DoNothing.instance);
      // 85-160 内ならどちらも通す
      expect(buyRule.shouldEntry(snapshotAt('149.995', '150.005'))).toBeInstanceOf(EntryCommand);
    });
  });

  describe('inner が DoNothing を返す場合', () => {
    it('価格帯とは無関係に inner の DoNothing をそのまま返す', () => {
      const rule = new PriceBandFilterEntryRule(new AlwaysDoNothing(), 85, null);
      expect(rule.shouldEntry(snapshotAt('70.000', '70.010'))).toBe(DoNothing.instance);
    });
  });
});
