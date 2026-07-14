import { describe, expect, it } from 'vitest';
import { Price } from '../Price.js';
import { TimeFrame } from '../TimeFrame.js';
import { CandleOpenTime } from '../candle/CandleOpenTime.js';
import { CandleCloseTime } from '../candle/CandleCloseTime.js';
import { ConfirmedCandle } from '../candle/ConfirmedCandle.js';
import { FormingCandle } from '../candle/FormingCandle.js';
import { IndicatorValues } from '../indicator/IndicatorValues.js';
import { SmaSnapshot } from '../indicator/SmaSnapshot.js';
import { SmaValue } from '../indicator/SmaValue.js';
import { Tick } from '../tick/Tick.js';
import { TickTimestamp } from '../tick/TickTimestamp.js';
import { TimeFrameSnapshot } from './TimeFrameSnapshot.js';

// ── テストヘルパー ──────────────────────────────────────────

const price = (v: string) => Price.of(v);

const confirmedCandle = (
  timeFrame: TimeFrame = TimeFrame.ONE_MINUTE,
  openIso = '2024-01-01T00:00:00Z',
  closeIso = '2024-01-01T00:01:00Z',
): ConfirmedCandle =>
  ConfirmedCandle.of({
    open: price('150.000'),
    high: price('151.000'),
    low: price('149.000'),
    close: price('150.500'),
    openTime: CandleOpenTime.of(new Date(openIso)),
    closeTime: CandleCloseTime.of(new Date(closeIso)),
    timeFrame,
  });

const formingCandle = (
  timeFrame: TimeFrame = TimeFrame.ONE_MINUTE,
  tickDate: Date = new Date('2024-01-01T00:01:00Z'),
): FormingCandle => {
  const ask = price('150.601');
  const bid = price('150.599');
  const tick = Tick.of(ask, bid, TickTimestamp.of(tickDate));
  return FormingCandle.open(tick, timeFrame);
};

const smaSnapshot = (
  shortSma: string,
  longSma: string,
  previousShortSma: string,
  previousLongSma: string,
): SmaSnapshot =>
  SmaSnapshot.of({
    shortSma: SmaValue.of(shortSma),
    longSma: SmaValue.of(longSma),
    previousShortSma: SmaValue.of(previousShortSma),
    previousLongSma: SmaValue.of(previousLongSma),
  });

const indicatorValues = (
  confirmedCurrent = '150.000',
  confirmedPrev = '149.000',
  formingCurrent = '150.500',
  formingPrev = '150.000',
): IndicatorValues =>
  IndicatorValues.of(
    smaSnapshot(confirmedCurrent, confirmedCurrent, confirmedPrev, confirmedPrev),
    smaSnapshot(formingCurrent, formingCurrent, formingPrev, formingPrev),
  );

const makeSnapshot = (
  timeFrame: TimeFrame = TimeFrame.ONE_MINUTE,
  indicators: IndicatorValues = indicatorValues(),
): TimeFrameSnapshot =>
  TimeFrameSnapshot.of({
    timeFrame,
    confirmed: confirmedCandle(timeFrame),
    forming: formingCandle(timeFrame),
    indicators,
  });

// ── テスト ──────────────────────────────────────────────────

describe('TimeFrameSnapshot', () => {
  describe('of()（生成・フィールド取得）', () => {
    it('of() で生成した TimeFrameSnapshot から timeFrame が取り出せる', () => {
      // Given: ONE_MINUTE の各要素
      // When: TimeFrameSnapshot.of() で生成する
      const snapshot = makeSnapshot(TimeFrame.ONE_MINUTE);

      // Then: timeFrame が ONE_MINUTE と一致する
      expect(snapshot.timeFrame).toBe(TimeFrame.ONE_MINUTE);
    });

    it('of() で生成した TimeFrameSnapshot から confirmedCandle が取り出せる', () => {
      // Given: 特定の ConfirmedCandle を渡す
      const candle = confirmedCandle(TimeFrame.ONE_MINUTE);

      // When: TimeFrameSnapshot.of() で生成して confirmedCandle を取得する
      const snapshot = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: candle,
        forming: formingCandle(TimeFrame.ONE_MINUTE),
        indicators: indicatorValues(),
      });

      // Then: 渡したローソク足と値が等しい
      expect(snapshot.confirmed.equals(candle)).toBe(true);
    });

    it('of() で生成した TimeFrameSnapshot から formingCandle が取り出せる', () => {
      // Given: 特定の FormingCandle を渡す
      const forming = formingCandle(TimeFrame.ONE_MINUTE);

      // When: TimeFrameSnapshot.of() で生成して formingCandle を取得する
      const snapshot = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: forming,
        indicators: indicatorValues(),
      });

      // Then: 取得した formingCandle は渡したオブジェクトと同一である
      expect(snapshot.forming).toBe(forming);
    });

    it('of() で生成した TimeFrameSnapshot から indicators が取り出せる', () => {
      // Given: 特定の IndicatorValues を渡す
      const indValues = indicatorValues('151.000', '150.000', '152.000', '151.000');

      // When: TimeFrameSnapshot.of() で生成して indicators を取得する
      const snapshot = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingCandle(TimeFrame.ONE_MINUTE),
        indicators: indValues,
      });

      // Then: 渡した IndicatorValues と値が等しい
      expect(snapshot.indicators.equals(indValues)).toBe(true);
    });

    it('ONE_HOUR の TimeFrameSnapshot も生成できる', () => {
      // Given: ONE_HOUR の時間足
      // When: of() で生成する
      const snapshot = makeSnapshot(TimeFrame.ONE_HOUR);

      // Then: timeFrame が ONE_HOUR と一致する
      expect(snapshot.timeFrame).toBe(TimeFrame.ONE_HOUR);
    });

    it('ONE_DAY の TimeFrameSnapshot も生成できる', () => {
      // Given: ONE_DAY の時間足
      // When: of() で生成する
      const snapshot = makeSnapshot(TimeFrame.ONE_DAY);

      // Then: timeFrame が ONE_DAY と一致する
      expect(snapshot.timeFrame).toBe(TimeFrame.ONE_DAY);
    });
  });

  describe('isFor()', () => {
    it('同じ timeFrame を渡したとき true を返す', () => {
      // Given: ONE_MINUTE の TimeFrameSnapshot
      const snapshot = makeSnapshot(TimeFrame.ONE_MINUTE);

      // When: isFor(ONE_MINUTE) を呼ぶ
      const result = snapshot.isFor(TimeFrame.ONE_MINUTE);

      // Then: true
      expect(result).toBe(true);
    });

    it('ONE_HOUR の TimeFrameSnapshot に ONE_HOUR を渡したとき true を返す', () => {
      // Given: ONE_HOUR の TimeFrameSnapshot
      const snapshot = makeSnapshot(TimeFrame.ONE_HOUR);

      // When: isFor(ONE_HOUR) を呼ぶ
      const result = snapshot.isFor(TimeFrame.ONE_HOUR);

      // Then: true
      expect(result).toBe(true);
    });

    it('ONE_DAY の TimeFrameSnapshot に ONE_DAY を渡したとき true を返す', () => {
      // Given: ONE_DAY の TimeFrameSnapshot
      const snapshot = makeSnapshot(TimeFrame.ONE_DAY);

      // When: isFor(ONE_DAY) を呼ぶ
      const result = snapshot.isFor(TimeFrame.ONE_DAY);

      // Then: true
      expect(result).toBe(true);
    });

    it('異なる timeFrame を渡したとき false を返す', () => {
      // Given: ONE_MINUTE の TimeFrameSnapshot
      const snapshot = makeSnapshot(TimeFrame.ONE_MINUTE);

      // When: isFor(ONE_HOUR) を呼ぶ
      const result = snapshot.isFor(TimeFrame.ONE_HOUR);

      // Then: false
      expect(result).toBe(false);
    });
  });

  describe('equals()', () => {
    it('同じ値で生成した 2 つの TimeFrameSnapshot は等価と判定される', () => {
      // Given: 同一の timeFrame / confirmedCandle / formingCandle / indicators で 2 つ生成
      const indValues = indicatorValues();
      const tickDate = new Date('2024-01-01T00:01:00Z');
      const a = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingCandle(TimeFrame.ONE_MINUTE, tickDate),
        indicators: indValues,
      });
      const b = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingCandle(TimeFrame.ONE_MINUTE, tickDate),
        indicators: indValues,
      });

      // When
      const result = a.equals(b);

      // Then
      expect(result).toBe(true);
    });

    it('timeFrame が異なるとき false を返す', () => {
      // Given: timeFrame だけ異なる 2 つのスナップショット
      const tickDate = new Date('2024-01-01T00:01:00Z');
      const indValues = indicatorValues();
      const a = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingCandle(TimeFrame.ONE_MINUTE, tickDate),
        indicators: indValues,
      });
      const b = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_HOUR,
        confirmed: confirmedCandle(TimeFrame.ONE_HOUR),
        forming: formingCandle(TimeFrame.ONE_HOUR, tickDate),
        indicators: indValues,
      });

      // When
      const result = a.equals(b);

      // Then
      expect(result).toBe(false);
    });

    it('confirmedCandle が異なるとき false を返す', () => {
      // Given: confirmedCandle の close だけ異なる
      const tickDate = new Date('2024-01-01T00:01:00Z');
      const indValues = indicatorValues();
      const a = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingCandle(TimeFrame.ONE_MINUTE, tickDate),
        indicators: indValues,
      });
      // close を変えた confirmedCandle
      const differentConfirmed = ConfirmedCandle.of({
        open: price('150.000'),
        high: price('151.000'),
        low: price('149.000'),
        close: price('149.500'), // 異なる close
        openTime: CandleOpenTime.of(new Date('2024-01-01T00:00:00Z')),
        closeTime: CandleCloseTime.of(new Date('2024-01-01T00:01:00Z')),
        timeFrame: TimeFrame.ONE_MINUTE,
      });
      const b = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: differentConfirmed,
        forming: formingCandle(TimeFrame.ONE_MINUTE, tickDate),
        indicators: indValues,
      });

      // When
      const result = a.equals(b);

      // Then
      expect(result).toBe(false);
    });

    it('formingCandle の openTime が異なるとき false を返す', () => {
      // Given: formingCandle の tick 時刻だけ異なる
      const indValues = indicatorValues();
      const a = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingCandle(TimeFrame.ONE_MINUTE, new Date('2024-01-01T00:01:00Z')),
        indicators: indValues,
      });
      const b = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingCandle(TimeFrame.ONE_MINUTE, new Date('2024-01-01T00:02:00Z')), // 異なる時刻
        indicators: indValues,
      });

      // When
      const result = a.equals(b);

      // Then
      expect(result).toBe(false);
    });

    it('formingCandle の currentClose が異なるとき false を返す', () => {
      // Given: 同じ openTime だが update() で close が異なる 2 つのスナップショット
      const tickDate = new Date('2024-01-01T00:01:00Z');
      const indValues = indicatorValues();

      // 1 tick 目（close = midPrice of ask=150.601, bid=150.599 → 150.600）
      const formingA = formingCandle(TimeFrame.ONE_MINUTE, tickDate);

      // update() で close を上に動かした FormingCandle
      const formingB = formingCandle(TimeFrame.ONE_MINUTE, tickDate);
      const higherAsk = price('155.001');
      const higherBid = price('154.999');
      formingB.update(Tick.of(higherAsk, higherBid, TickTimestamp.of(tickDate)));

      const a = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingA,
        indicators: indValues,
      });
      const b = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingB,
        indicators: indValues,
      });

      // When
      const result = a.equals(b);

      // Then
      expect(result).toBe(false);
    });

    it('formingCandle の currentHigh が異なるとき false を返す', () => {
      // Given: high だけが異なる（close は同じに戻す）
      const tickDate = new Date('2024-01-01T00:01:00Z');
      const indValues = indicatorValues();

      const formingA = formingCandle(TimeFrame.ONE_MINUTE, tickDate);

      const formingB = formingCandle(TimeFrame.ONE_MINUTE, tickDate);
      // high を上げる tick を打った後、close を元に戻す tick を打つ
      formingB.update(
        Tick.of(price('160.001'), price('159.999'), TickTimestamp.of(tickDate)),
      );
      formingB.update(
        Tick.of(price('150.601'), price('150.599'), TickTimestamp.of(tickDate)),
      );

      const a = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingA,
        indicators: indValues,
      });
      const b = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingB,
        indicators: indValues,
      });

      // When
      const result = a.equals(b);

      // Then: high が異なるので false
      expect(result).toBe(false);
    });

    it('formingCandle の currentLow が異なるとき false を返す', () => {
      // Given: low だけが異なる（close を元に戻す）
      const tickDate = new Date('2024-01-01T00:01:00Z');
      const indValues = indicatorValues();

      const formingA = formingCandle(TimeFrame.ONE_MINUTE, tickDate);

      const formingB = formingCandle(TimeFrame.ONE_MINUTE, tickDate);
      // low を下げる tick を打った後、close を元に戻す tick を打つ
      formingB.update(
        Tick.of(price('140.001'), price('139.999'), TickTimestamp.of(tickDate)),
      );
      formingB.update(
        Tick.of(price('150.601'), price('150.599'), TickTimestamp.of(tickDate)),
      );

      const a = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingA,
        indicators: indValues,
      });
      const b = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingB,
        indicators: indValues,
      });

      // When
      const result = a.equals(b);

      // Then: low が異なるので false
      expect(result).toBe(false);
    });

    it('formingCandle の openPrice が異なるとき false を返す', () => {
      // Given: 最初の tick（= open 価格）が異なる 2 つのスナップショット
      const tickDate = new Date('2024-01-01T00:01:00Z');
      const indValues = indicatorValues();

      // formingA の open = midPrice(150.601, 150.599) = 150.600
      const formingA = formingCandle(TimeFrame.ONE_MINUTE, tickDate);

      // formingB の open = midPrice(160.001, 159.999) = 160.000（openPrice が異なる）
      const differentOpenTick = Tick.of(
        price('160.001'),
        price('159.999'),
        TickTimestamp.of(tickDate),
      );
      const formingB = FormingCandle.open(differentOpenTick, TimeFrame.ONE_MINUTE);

      const a = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingA,
        indicators: indValues,
      });
      const b = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingB,
        indicators: indValues,
      });

      // When
      const result = a.equals(b);

      // Then: openPrice が異なるので false
      expect(result).toBe(false);
    });

    it('indicators が異なるとき false を返す', () => {
      // Given: indicators だけ異なる
      const tickDate = new Date('2024-01-01T00:01:00Z');
      const a = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingCandle(TimeFrame.ONE_MINUTE, tickDate),
        indicators: indicatorValues('150.000', '149.000', '150.500', '150.000'),
      });
      const b = TimeFrameSnapshot.of({
        timeFrame: TimeFrame.ONE_MINUTE,
        confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
        forming: formingCandle(TimeFrame.ONE_MINUTE, tickDate),
        indicators: indicatorValues('999.000', '149.000', '150.500', '150.000'), // confirmed.sma.current が異なる
      });

      // When
      const result = a.equals(b);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('of() バリデーション（timeFrame 整合性）', () => {
    it('confirmedCandle の timeFrame が params.timeFrame と異なるとき例外を投げる', () => {
      // Given: confirmedCandle だけ ONE_HOUR
      expect(() =>
        TimeFrameSnapshot.of({
          timeFrame: TimeFrame.ONE_MINUTE,
          confirmed: confirmedCandle(TimeFrame.ONE_HOUR),
          forming: formingCandle(TimeFrame.ONE_MINUTE),
          indicators: indicatorValues(),
        }),
      ).toThrow('confirmed の timeFrame が一致しません');
    });

    it('formingCandle の timeFrame が params.timeFrame と異なるとき例外を投げる', () => {
      // Given: formingCandle だけ ONE_HOUR
      expect(() =>
        TimeFrameSnapshot.of({
          timeFrame: TimeFrame.ONE_MINUTE,
          confirmed: confirmedCandle(TimeFrame.ONE_MINUTE),
          forming: formingCandle(TimeFrame.ONE_HOUR),
          indicators: indicatorValues(),
        }),
      ).toThrow('forming の timeFrame が一致しません');
    });

    it('confirmedCandle と formingCandle の両方が params.timeFrame と異なるとき confirmedCandle のバリデーションが先に発火する', () => {
      // Given: confirmedCandle も formingCandle も ONE_HOUR（params は ONE_MINUTE）
      expect(() =>
        TimeFrameSnapshot.of({
          timeFrame: TimeFrame.ONE_MINUTE,
          confirmed: confirmedCandle(TimeFrame.ONE_HOUR),
          forming: formingCandle(TimeFrame.ONE_HOUR),
          indicators: indicatorValues(),
        }),
      ).toThrow('confirmed の timeFrame が一致しません');
    });

    it('ONE_HOUR の params に ONE_DAY の confirmedCandle を渡したとき例外を投げる', () => {
      // Given: confirmedCandle が ONE_DAY（params は ONE_HOUR）
      expect(() =>
        TimeFrameSnapshot.of({
          timeFrame: TimeFrame.ONE_HOUR,
          confirmed: confirmedCandle(TimeFrame.ONE_DAY),
          forming: formingCandle(TimeFrame.ONE_HOUR),
          indicators: indicatorValues(),
        }),
      ).toThrow('confirmed の timeFrame が一致しません');
    });
  });
});
