import { describe, it, expect } from 'vitest';
import { SmaCrossEntryRule } from './SmaCrossEntryRule.js';
import { Lot } from '../../position/Lot.js';
import { SizingResult } from '../../position/SizingResult.js';
import { MarginRate } from '../../position/MarginRate.js';
import { Rate } from '../../market/Rate.js';
import { EntryCommand } from '../../command/EntryCommand.js';
import { DoNothing } from '../../command/DoNothing.js';
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

const now = new Date('2026-03-30T10:00:00Z');

const makeSmaSnapshot = (
  short: string,
  long: string,
  prevShort: string,
  prevLong: string,
) =>
  SmaSnapshot.of({
    shortSma: SmaValue.of(short),
    longSma: SmaValue.of(long),
    previousShortSma: SmaValue.of(prevShort),
    previousLongSma: SmaValue.of(prevLong),
  });

const makeCandle = (tf: TimeFrame) =>
  ConfirmedCandle.of({
    open: Price.of('150'),
    high: Price.of('151'),
    low: Price.of('149'),
    close: Price.of('150.5'),
    openTime: CandleOpenTime.of(new Date(now.getTime() - 60000)),
    closeTime: CandleCloseTime.of(new Date(now.getTime() - 1)),
    timeFrame: tf,
  });

const makeForming = (tf: TimeFrame) => {
  const tick = Tick.of(Price.of('150.5'), Price.of('150.495'), TickTimestamp.of(now));
  return FormingCandle.open(tick, tf);
};

const makeSnapshot = (confirmedSma: SmaSnapshot): MarketSnapshot => {
  const tfMap = new Map<TimeFrame, TimeFrameSnapshot>();
  for (const tf of LIVE_TIMEFRAMES) {
    const sma = tf === TimeFrame.FIFTEEN_MINUTE ? confirmedSma : makeSmaSnapshot('150', '150', '150', '150');
    tfMap.set(
      tf,
      TimeFrameSnapshot.of({
        timeFrame: tf,
        confirmed: makeCandle(tf),
        forming: makeForming(tf),
        indicators: IndicatorValues.of(sma, makeSmaSnapshot('150', '150', '150', '150')),
      }),
    );
  }
  return MarketSnapshot.of({
    timeFrames: tfMap,
    tick: Tick.of(Price.of('150.5'), Price.of('150.495'), TickTimestamp.of(now)),
    pair: CurrencyPair('USD_JPY'),
    capturedAt: Timestamp.of(now),
  });
};

describe('SmaCrossEntryRule', () => {
  const PAIR = CurrencyPair('USD_JPY');
  const SIZING = SizingResult.of(
    Lot.of(100),
    Rate.of('150', PAIR, now),
    MarginRate.of('0.04'),
  );
  const rule = new SmaCrossEntryRule(
    TimeFrame.FIFTEEN_MINUTE,
    () => SIZING,
  );

  it('ゴールデンクロスで BUY の EntryCommand を返す（requiredMargin が getSizing から伝搬される）', () => {
    // Given: 前回は短期 < 長期、今回は短期 > 長期
    const sma = makeSmaSnapshot('150.5', '150.3', '149.8', '150.1');
    const snapshot = makeSnapshot(sma);

    // When
    const result = rule.shouldEntry(snapshot);

    // Then
    expect(result).toBeInstanceOf(EntryCommand);
    const cmd = result as EntryCommand;
    expect(cmd.buySell).toBe('BUY');
    // SIZING.requiredMargin() の値が EntryCommand.requiredMargin に
    // 伝搬されているか検証する（SIZING の値が変わっても自動追従するよう
    // ハードコード値ではなく SIZING 経由で比較）
    expect(cmd.requiredMargin.equals(SIZING.requiredMargin())).toBe(true);
  });

  it('デッドクロスで SELL の EntryCommand を返す（requiredMargin が getSizing から伝搬される）', () => {
    // Given: 前回は短期 > 長期、今回は短期 < 長期
    const sma = makeSmaSnapshot('149.8', '150.1', '150.5', '150.3');
    const snapshot = makeSnapshot(sma);

    // When
    const result = rule.shouldEntry(snapshot);

    // Then
    expect(result).toBeInstanceOf(EntryCommand);
    const cmd = result as EntryCommand;
    expect(cmd.buySell).toBe('SELL');
    // BUY と同じ getSizing 経由なので SIZING.requiredMargin() が伝搬される
    expect(cmd.requiredMargin.equals(SIZING.requiredMargin())).toBe(true);
  });

  it('クロスなしで DoNothing を返す', () => {
    // Given: 短期 > 長期 のまま変化なし
    const sma = makeSmaSnapshot('150.5', '150.3', '150.4', '150.2');
    const snapshot = makeSnapshot(sma);

    // When
    const result = rule.shouldEntry(snapshot);

    // Then
    expect(result).toBe(DoNothing.instance);
  });

});
