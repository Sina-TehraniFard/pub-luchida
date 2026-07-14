import { describe, it, expect } from 'vitest';
import { MarketSnapshot } from './MarketSnapshot.js';
import { TimeFrameSnapshot } from './TimeFrameSnapshot.js';
import { TimeFrame } from '../TimeFrame.js';
import { Tick } from '../tick/Tick.js';
import { Price } from '../Price.js';
import { TickTimestamp } from '../tick/TickTimestamp.js';
import { ConfirmedCandle } from '../candle/ConfirmedCandle.js';
import { FormingCandle } from '../candle/FormingCandle.js';
import { CandleOpenTime } from '../candle/CandleOpenTime.js';
import { CandleCloseTime } from '../candle/CandleCloseTime.js';
import { IndicatorValues } from '../indicator/IndicatorValues.js';
import { SmaSnapshot } from '../indicator/SmaSnapshot.js';
import { SmaValue } from '../indicator/SmaValue.js';
import { CurrencyPair } from '../CurrencyPair.js';
import { Timestamp } from '../Timestamp.js';

// ── テストヘルパー ──────────────────────────────────────────

const p = (v: string) => Price.of(v);

const makeTick = (ask: string, bid: string, iso: string): Tick =>
  Tick.of(p(ask), p(bid), TickTimestamp.of(new Date(iso)));

const makeConfirmedCandle = (timeFrame: TimeFrame): ConfirmedCandle =>
  ConfirmedCandle.of({
    open: p('150.000'),
    high: p('151.000'),
    low: p('149.000'),
    close: p('150.500'),
    openTime: CandleOpenTime.of(new Date('2024-01-15T10:00:00.000Z')),
    closeTime: CandleCloseTime.of(new Date('2024-01-15T10:01:00.000Z')),
    timeFrame,
  });

const makeFormingCandle = (timeFrame: TimeFrame): FormingCandle =>
  FormingCandle.open(
    makeTick('150.600', '150.400', '2024-01-15T10:01:00.000Z'),
    timeFrame,
  );

const makeIndicators = (): IndicatorValues =>
  IndicatorValues.of(
    SmaSnapshot.of({
      shortSma: SmaValue.of('150.500'),
      longSma: SmaValue.of('150.400'),
      previousShortSma: SmaValue.of('150.300'),
      previousLongSma: SmaValue.of('150.200'),
    }),
    SmaSnapshot.of({
      shortSma: SmaValue.of('150.550'),
      longSma: SmaValue.of('150.450'),
      previousShortSma: SmaValue.of('150.400'),
      previousLongSma: SmaValue.of('150.250'),
    }),
  );

const makeTimeFrameSnapshot = (timeFrame: TimeFrame): TimeFrameSnapshot =>
  TimeFrameSnapshot.of({
    timeFrame,
    confirmed: makeConfirmedCandle(timeFrame),
    forming: makeFormingCandle(timeFrame),
    indicators: makeIndicators(),
  });

const makeLatestTick = (): Tick =>
  makeTick('150.700', '150.500', '2024-01-15T10:01:30.000Z');

const makePair = (): CurrencyPair => CurrencyPair('USD_JPY');
const makeCapturedAt = (): Timestamp => Timestamp.of(new Date('2024-01-15T10:01:30.000Z'));

const makeFullTimeFrames = (): ReadonlyMap<TimeFrame, TimeFrameSnapshot> =>
  new Map([
    [TimeFrame.ONE_MINUTE, makeTimeFrameSnapshot(TimeFrame.ONE_MINUTE)],
    [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
    [TimeFrame.ONE_HOUR, makeTimeFrameSnapshot(TimeFrame.ONE_HOUR)],
    [TimeFrame.ONE_DAY, makeTimeFrameSnapshot(TimeFrame.ONE_DAY)],
  ]);

/**
 * 指定した TimeFrame の confirmedCandle の価格だけ変えた TimeFrameSnapshot を生成する。
 * equals() の不一致ケースを作るために使う。
 */
const makeAltTimeFrameSnapshot = (timeFrame: TimeFrame): TimeFrameSnapshot =>
  TimeFrameSnapshot.of({
    timeFrame,
    confirmed: ConfirmedCandle.of({
      open: p('999.000'),
      high: p('999.500'),
      low: p('998.000'),
      close: p('999.200'),
      openTime: CandleOpenTime.of(new Date('2024-01-15T10:00:00.000Z')),
      closeTime: CandleCloseTime.of(new Date('2024-01-15T10:01:00.000Z')),
      timeFrame,
    }),
    forming: makeFormingCandle(timeFrame),
    indicators: makeIndicators(),
  });

// ── テスト ──────────────────────────────────────────────────

describe('MarketSnapshot', () => {
  const pair = makePair();
  const capturedAt = makeCapturedAt();

  describe('of()（生成）', () => {
    it('3つの TimeFrame スナップショットと直近 Tick を渡すと MarketSnapshot が生成され、各値が保持される', () => {
      // Given: 3つの TimeFrame スナップショットと直近 Tick
      const timeFrames = makeFullTimeFrames();
      const tick = makeLatestTick();

      // When: MarketSnapshot.of() で生成する
      const snapshot = MarketSnapshot.of({ timeFrames, tick, pair, capturedAt });

      // Then: インスタンスが生成され、tick が保持されている
      expect(snapshot).toBeInstanceOf(MarketSnapshot);
      expect(snapshot.tick.equals(tick)).toBe(true);
    });

    it('ONE_MINUTE が欠落している場合はエラーがスローされる', () => {
      // Given: ONE_MINUTE を含まない timeFrames
      const timeFrames: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_HOUR, makeTimeFrameSnapshot(TimeFrame.ONE_HOUR)],
        [TimeFrame.ONE_DAY, makeTimeFrameSnapshot(TimeFrame.ONE_DAY)],
      ]);

      // When / Then: of() がエラーをスロー
      expect(() => MarketSnapshot.of({ timeFrames, tick: makeLatestTick(), pair, capturedAt })).toThrow(
        'MarketSnapshot: 必須の TimeFrame が不足しています: ONE_MINUTE',
      );
    });

    it('ONE_HOUR が欠落している場合はエラーがスローされる', () => {
      // Given: ONE_HOUR を含まない timeFrames
      const timeFrames: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.ONE_MINUTE, makeTimeFrameSnapshot(TimeFrame.ONE_MINUTE)],
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_DAY, makeTimeFrameSnapshot(TimeFrame.ONE_DAY)],
      ]);

      // When / Then: of() がエラーをスロー
      expect(() => MarketSnapshot.of({ timeFrames, tick: makeLatestTick(), pair, capturedAt })).toThrow(
        'MarketSnapshot: 必須の TimeFrame が不足しています: ONE_HOUR',
      );
    });

    it('ONE_DAY が欠落している場合はエラーがスローされる', () => {
      // Given: ONE_DAY を含まない timeFrames
      const timeFrames: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.ONE_MINUTE, makeTimeFrameSnapshot(TimeFrame.ONE_MINUTE)],
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_HOUR, makeTimeFrameSnapshot(TimeFrame.ONE_HOUR)],
      ]);

      // When / Then: of() がエラーをスロー
      expect(() => MarketSnapshot.of({ timeFrames, tick: makeLatestTick(), pair, capturedAt })).toThrow(
        'MarketSnapshot: 必須の TimeFrame が不足しています: ONE_DAY',
      );
    });

    it('空の timeFrames Map を渡すとエラーがスローされる', () => {
      // Given: スナップショットが1つもない Map
      const timeFrames: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map();

      // When / Then: of() がエラーをスロー
      expect(() => MarketSnapshot.of({ timeFrames, tick: makeLatestTick(), pair, capturedAt })).toThrow(
        'MarketSnapshot: 必須の TimeFrame が不足しています',
      );
    });
  });

  describe('tick の取得', () => {
    it('of() で渡した tick が正しく保持される', () => {
      // Given: 特定の Tick を直近 Tick として渡す
      const tick = makeLatestTick();

      // When: MarketSnapshot.of() で生成して tick を取得する
      const marketSnapshot = MarketSnapshot.of({ timeFrames: makeFullTimeFrames(), tick, pair, capturedAt });

      // Then: 渡した Tick と等価である
      expect(marketSnapshot.tick.equals(tick)).toBe(true);
    });
  });

  describe('snapshotOf()（TimeFrame 別スナップショット取得）', () => {
    it('ONE_MINUTE の TimeFrameSnapshot が取得できる', () => {
      // Given: 4つの TimeFrame スナップショットを持つ MarketSnapshot
      const oneMinuteSnapshot = makeTimeFrameSnapshot(TimeFrame.ONE_MINUTE);
      const timeFrames: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.ONE_MINUTE, oneMinuteSnapshot],
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_HOUR, makeTimeFrameSnapshot(TimeFrame.ONE_HOUR)],
        [TimeFrame.ONE_DAY, makeTimeFrameSnapshot(TimeFrame.ONE_DAY)],
      ]);
      const marketSnapshot = MarketSnapshot.of({ timeFrames, tick: makeLatestTick(), pair, capturedAt });

      // When: snapshotOf(ONE_MINUTE) を呼ぶ
      const result = marketSnapshot.snapshotOf(TimeFrame.ONE_MINUTE);

      // Then: ONE_MINUTE の TimeFrameSnapshot と等価なものが返る
      expect(result.equals(oneMinuteSnapshot)).toBe(true);
    });

    it('ONE_HOUR の TimeFrameSnapshot が取得できる', () => {
      // Given: 4つの TimeFrame スナップショットを持つ MarketSnapshot
      const oneHourSnapshot = makeTimeFrameSnapshot(TimeFrame.ONE_HOUR);
      const timeFrames: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.ONE_MINUTE, makeTimeFrameSnapshot(TimeFrame.ONE_MINUTE)],
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_HOUR, oneHourSnapshot],
        [TimeFrame.ONE_DAY, makeTimeFrameSnapshot(TimeFrame.ONE_DAY)],
      ]);
      const marketSnapshot = MarketSnapshot.of({ timeFrames, tick: makeLatestTick(), pair, capturedAt });

      // When: snapshotOf(ONE_HOUR) を呼ぶ
      const result = marketSnapshot.snapshotOf(TimeFrame.ONE_HOUR);

      // Then: ONE_HOUR の TimeFrameSnapshot と等価なものが返る
      expect(result.equals(oneHourSnapshot)).toBe(true);
    });

    it('ONE_DAY の TimeFrameSnapshot が取得できる', () => {
      // Given: 4つの TimeFrame スナップショットを持つ MarketSnapshot
      const oneDaySnapshot = makeTimeFrameSnapshot(TimeFrame.ONE_DAY);
      const timeFrames: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.ONE_MINUTE, makeTimeFrameSnapshot(TimeFrame.ONE_MINUTE)],
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_HOUR, makeTimeFrameSnapshot(TimeFrame.ONE_HOUR)],
        [TimeFrame.ONE_DAY, oneDaySnapshot],
      ]);
      const marketSnapshot = MarketSnapshot.of({ timeFrames, tick: makeLatestTick(), pair, capturedAt });

      // When: snapshotOf(ONE_DAY) を呼ぶ
      const result = marketSnapshot.snapshotOf(TimeFrame.ONE_DAY);

      // Then: ONE_DAY の TimeFrameSnapshot と等価なものが返る
      expect(result.equals(oneDaySnapshot)).toBe(true);
    });

    it('存在しない TimeFrame を渡した場合はエラーがスローされる', () => {
      // Given: 通常の3つの TimeFrame スナップショットを持つ MarketSnapshot
      const marketSnapshot = MarketSnapshot.of({
        timeFrames: makeFullTimeFrames(),
        tick: makeLatestTick(),
        pair,
        capturedAt,
      });

      // When / Then: 存在しない TimeFrame 文字列を渡すとエラーをスロー
      expect(() =>
        marketSnapshot.snapshotOf('UNKNOWN_FRAME' as TimeFrame),
      ).toThrow(
        'MarketSnapshot: 指定した TimeFrame のスナップショットが存在しません: timeFrame=UNKNOWN_FRAME',
      );
    });
  });

  describe('equals()（同値比較）', () => {
    it('同じ timeFrames と tick を持つ MarketSnapshot は等値である', () => {
      // Given: 同一内容の2つの MarketSnapshot
      const timeFrames = makeFullTimeFrames();
      const tick = makeLatestTick();
      const a = MarketSnapshot.of({ timeFrames, tick, pair, capturedAt });
      const b = MarketSnapshot.of({ timeFrames, tick, pair, capturedAt });

      // When / Then: equals() が true を返す
      expect(a.equals(b)).toBe(true);
    });

    it('tick が異なる場合は等値でない', () => {
      // Given: tick だけ異なる2つの MarketSnapshot
      const timeFrames = makeFullTimeFrames();
      const a = MarketSnapshot.of({
        timeFrames,
        tick: makeTick('150.700', '150.500', '2024-01-15T10:01:30.000Z'),
        pair,
        capturedAt,
      });
      const b = MarketSnapshot.of({
        timeFrames,
        tick: makeTick('150.800', '150.600', '2024-01-15T10:01:30.000Z'),
        pair,
        capturedAt,
      });

      // When / Then: equals() が false を返す
      expect(a.equals(b)).toBe(false);
    });

    it('ONE_MINUTE の TimeFrameSnapshot が異なる場合は等値でない', () => {
      // Given: ONE_MINUTE のスナップショットだけ異なる2つの MarketSnapshot
      const tick = makeLatestTick();
      const timeFramesA: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.ONE_MINUTE, makeTimeFrameSnapshot(TimeFrame.ONE_MINUTE)],
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_HOUR, makeTimeFrameSnapshot(TimeFrame.ONE_HOUR)],
        [TimeFrame.ONE_DAY, makeTimeFrameSnapshot(TimeFrame.ONE_DAY)],
      ]);
      const timeFramesB: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.ONE_MINUTE, makeAltTimeFrameSnapshot(TimeFrame.ONE_MINUTE)],
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_HOUR, makeTimeFrameSnapshot(TimeFrame.ONE_HOUR)],
        [TimeFrame.ONE_DAY, makeTimeFrameSnapshot(TimeFrame.ONE_DAY)],
      ]);
      const a = MarketSnapshot.of({ timeFrames: timeFramesA, tick, pair, capturedAt });
      const b = MarketSnapshot.of({ timeFrames: timeFramesB, tick, pair, capturedAt });

      // When / Then: equals() が false を返す
      expect(a.equals(b)).toBe(false);
    });

    it('ONE_HOUR の TimeFrameSnapshot が異なる場合は等値でない', () => {
      // Given: ONE_HOUR のスナップショットだけ異なる2つの MarketSnapshot
      const tick = makeLatestTick();
      const timeFramesA: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.ONE_MINUTE, makeTimeFrameSnapshot(TimeFrame.ONE_MINUTE)],
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_HOUR, makeTimeFrameSnapshot(TimeFrame.ONE_HOUR)],
        [TimeFrame.ONE_DAY, makeTimeFrameSnapshot(TimeFrame.ONE_DAY)],
      ]);
      const timeFramesB: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.ONE_MINUTE, makeTimeFrameSnapshot(TimeFrame.ONE_MINUTE)],
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_HOUR, makeAltTimeFrameSnapshot(TimeFrame.ONE_HOUR)],
        [TimeFrame.ONE_DAY, makeTimeFrameSnapshot(TimeFrame.ONE_DAY)],
      ]);
      const a = MarketSnapshot.of({ timeFrames: timeFramesA, tick, pair, capturedAt });
      const b = MarketSnapshot.of({ timeFrames: timeFramesB, tick, pair, capturedAt });

      // When / Then: equals() が false を返す
      expect(a.equals(b)).toBe(false);
    });

    it('ONE_DAY の TimeFrameSnapshot が異なる場合は等値でない', () => {
      // Given: ONE_DAY のスナップショットだけ異なる2つの MarketSnapshot
      const tick = makeLatestTick();
      const timeFramesA: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.ONE_MINUTE, makeTimeFrameSnapshot(TimeFrame.ONE_MINUTE)],
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_HOUR, makeTimeFrameSnapshot(TimeFrame.ONE_HOUR)],
        [TimeFrame.ONE_DAY, makeTimeFrameSnapshot(TimeFrame.ONE_DAY)],
      ]);
      const timeFramesB: ReadonlyMap<TimeFrame, TimeFrameSnapshot> = new Map([
        [TimeFrame.ONE_MINUTE, makeTimeFrameSnapshot(TimeFrame.ONE_MINUTE)],
        [TimeFrame.FIFTEEN_MINUTE, makeTimeFrameSnapshot(TimeFrame.FIFTEEN_MINUTE)],
        [TimeFrame.ONE_HOUR, makeTimeFrameSnapshot(TimeFrame.ONE_HOUR)],
        [TimeFrame.ONE_DAY, makeAltTimeFrameSnapshot(TimeFrame.ONE_DAY)],
      ]);
      const a = MarketSnapshot.of({ timeFrames: timeFramesA, tick, pair, capturedAt });
      const b = MarketSnapshot.of({ timeFrames: timeFramesB, tick, pair, capturedAt });

      // When / Then: equals() が false を返す
      expect(a.equals(b)).toBe(false);
    });
  });
});
