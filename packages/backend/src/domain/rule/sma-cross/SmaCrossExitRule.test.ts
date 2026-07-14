import { describe, it, expect } from 'vitest';
import { SmaCrossExitRule } from './SmaCrossExitRule.js';
import { DoNothing } from '../../command/DoNothing.js';
import { ExitCommand, ExitType } from '../../command/ExitCommand.js';
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
import { Position } from '../../position/Position.js';
import { EntryCommand } from '../../command/EntryCommand.js';
import { EntryResult } from '../../market/EntryResult.js';
import { EntryReason } from '../../command/EntryReason.js';
import { ConvictionScore } from '../../market/ConvictionScore.js';
import { Lot } from '../../position/Lot.js';
import { PositionId } from '../../position/PositionId.js';
import { StrategyName } from '../StrategyName.js';
import { EntrySnapshot } from '../../market/snapshot/EntrySnapshot.js';
import { Money } from '../../Money.js';

const DUMMY_SNAPSHOT = EntrySnapshot.of({ convictionScore: '0.5', entryHour: 12, entryDayOfWeek: 3 });

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

const makePosition = (buySell: 'BUY' | 'SELL', entryPrice: string): Position => {
  const command = EntryCommand.of({
    pair: CurrencyPair('USD_JPY'),
    buySell,
    lot: Lot.of(1000),
    reason: EntryReason.of('テスト'),
    convictionScore: ConvictionScore.of('0.7'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: DUMMY_SNAPSHOT,
    requiredMargin: Money.jpy('6000'),
  });
  const result = EntryResult.of({
    positionId: PositionId.from('test-pos-1'),
    entryPrice: Price.of(entryPrice),
    executedAt: Timestamp.of(now),
  });
  return Position.open(command, result);
};

describe('SmaCrossExitRule', () => {
  const rule = new SmaCrossExitRule(TimeFrame.FIFTEEN_MINUTE);

  it('BUYポジション + デッドクロスで ExitCommand を返す', () => {
    const sma = makeSmaSnapshot('149.8', '150.1', '150.5', '150.3');
    const snapshot = makeSnapshot(sma);
    const position = makePosition('BUY', '150.000');

    const result = rule.shouldExit(snapshot, position);

    expect(result).toBeInstanceOf(ExitCommand);
    const cmd = result as ExitCommand;
    expect(cmd.reason.toString()).toContain('デッドクロス');
  });

  it('SELLポジション + ゴールデンクロスで ExitCommand を返す', () => {
    const sma = makeSmaSnapshot('150.5', '150.3', '149.8', '150.1');
    const snapshot = makeSnapshot(sma);
    const position = makePosition('SELL', '150.000');

    const result = rule.shouldExit(snapshot, position);

    expect(result).toBeInstanceOf(ExitCommand);
    const cmd = result as ExitCommand;
    expect(cmd.reason.toString()).toContain('ゴールデンクロス');
  });

  it('BUYポジション + ゴールデンクロスでは DoNothing を返す', () => {
    const sma = makeSmaSnapshot('150.5', '150.3', '149.8', '150.1');
    const snapshot = makeSnapshot(sma);
    const position = makePosition('BUY', '150.000');

    const result = rule.shouldExit(snapshot, position);

    expect(result).toBe(DoNothing.instance);
  });

  it('クロスなしでは DoNothing を返す', () => {
    const sma = makeSmaSnapshot('150.5', '150.3', '150.4', '150.2');
    const snapshot = makeSnapshot(sma);
    const position = makePosition('BUY', '150.000');

    const result = rule.shouldExit(snapshot, position);

    expect(result).toBe(DoNothing.instance);
  });

  it('利確時は TAKE_PROFIT を返す', () => {
    const sma = makeSmaSnapshot('149.8', '150.1', '150.5', '150.3');
    const snapshot = makeSnapshot(sma);
    const position = makePosition('BUY', '149.000');

    const result = rule.shouldExit(snapshot, position);

    expect(result).toBeInstanceOf(ExitCommand);
    expect((result as ExitCommand).type).toBe(ExitType.TAKE_PROFIT);
  });

  it('損切り時は STOP_LOSS を返す', () => {
    const sma = makeSmaSnapshot('149.8', '150.1', '150.5', '150.3');
    const snapshot = makeSnapshot(sma);
    const position = makePosition('BUY', '151.000');

    const result = rule.shouldExit(snapshot, position);

    expect(result).toBeInstanceOf(ExitCommand);
    expect((result as ExitCommand).type).toBe(ExitType.STOP_LOSS);
  });
});
