import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Price } from './Price.js';
import { LIVE_TIMEFRAMES, TimeFrame } from './TimeFrame.js';
import { CandleCloseTime } from './candle/CandleCloseTime.js';
import { CandleOpenTime } from './candle/CandleOpenTime.js';
import { ConfirmedCandle } from './candle/ConfirmedCandle.js';
import { Tick } from './tick/Tick.js';
import { TickTimestamp } from './tick/TickTimestamp.js';
import type { SmaCalculator, SmaCalculatorFactory } from './indicator/SmaCalculator.js';
import { CurrencyPair } from './CurrencyPair.js';
import { IndicatorConfig } from './indicator/IndicatorConfig.js';
import { TimeFrameBook } from './TimeFrameBook.js';

/**
 * テスト用の素朴な SMA 実装。domain 層内で完結する
 */
class SimpleSmaCalculator implements SmaCalculator {
  private readonly period: number;
  private readonly values: number[] = [];
  private replaced = false;

  constructor(period: number) {
    this.period = period;
  }

  add(value: number): void {
    this.values.push(value);
    this.replaced = false;
  }

  replace(value: number): void {
    if (this.values.length === 0) return;
    this.values[this.values.length - 1] = value;
  }

  isStable(): boolean {
    return this.values.length >= this.period;
  }

  getResult(): number {
    const window = this.values.slice(-this.period);
    return window.reduce((sum, v) => sum + v, 0) / window.length;
  }
}

const factory: SmaCalculatorFactory = {
  create: (period: number) => new SimpleSmaCalculator(period),
};

// ── テストヘルパー ──────────────────────────────────────────

const SHORT_PERIOD = 3;
const LONG_PERIOD = 5;

/** close 値と index から ConfirmedCandle を作る（指定した timeFrame） */
const candle = (
  close: string,
  index: number,
  timeFrame: TimeFrame,
  durationMs: number,
): ConfirmedCandle => {
  const baseMs = new Date('2024-01-15T00:00:00.000Z').getTime();
  const openMs = baseMs + index * durationMs;
  const closeMs = openMs + durationMs;
  const p = Price.of(close);
  return ConfirmedCandle.of({
    open: p,
    high: p,
    low: p,
    close: p,
    openTime: CandleOpenTime.of(new Date(openMs)),
    closeTime: CandleCloseTime.of(new Date(closeMs)),
    timeFrame,
  });
};

/** tick を作る（bid = midApprox - 0.001, ask = midApprox + 0.001） */
const tick = (midApprox: string, isoTime: string): Tick => {
  const mid = parseFloat(midApprox);
  const ask = Price.of(String(mid + 0.001));
  const bid = Price.of(String(mid - 0.001));
  return Tick.of(ask, bid, TickTimestamp.of(new Date(isoTime)));
};

/** warmUp 用: close = 100..104 の 5本 */
const warmUpData = (
  timeFrame: TimeFrame,
  durationMs: number,
): ConfirmedCandle[] =>
  [100, 101, 102, 103, 104].map((v, i) =>
    candle(String(v), i, timeFrame, durationMs),
  );

// ── テスト ──────────────────────────────────────────────────
describe('TimeFrameBook', () => {
  let book: TimeFrameBook;

  /** 全時間足を warmUp する共通セットアップ */
  const warmUpAll = () => {
    book.warmUp(TimeFrame.ONE_MINUTE, warmUpData(TimeFrame.ONE_MINUTE, 60_000));
    book.warmUp(TimeFrame.FIFTEEN_MINUTE, warmUpData(TimeFrame.FIFTEEN_MINUTE, 900_000));
    book.warmUp(TimeFrame.ONE_HOUR, warmUpData(TimeFrame.ONE_HOUR, 3_600_000));
    book.warmUp(TimeFrame.ONE_DAY, warmUpData(TimeFrame.ONE_DAY, 86_400_000));
  };

  beforeEach(() => {
    const config = IndicatorConfig.of({ shortSmaPeriod: SHORT_PERIOD, longSmaPeriod: LONG_PERIOD });
    book = new TimeFrameBook(CurrencyPair('USD_JPY'), config, factory);
  });

  describe('warmUp()', () => {
    it('空の配列を渡すとエラーになる', () => {
      expect(() => book.warmUp(TimeFrame.ONE_MINUTE, [])).toThrow(
        'warmUp に空の配列が渡されました',
      );
    });

    it('別時間足の足が混入しているとエラーになる', () => {
      // Given: 1分足を warmUp するのに15分足が1本混ざった配列
      const mixed = [
        candle('100', 0, TimeFrame.ONE_MINUTE, 60_000),
        candle('101', 1, TimeFrame.FIFTEEN_MINUTE, 900_000),
      ];

      // When / Then
      expect(() => book.warmUp(TimeFrame.ONE_MINUTE, mixed)).toThrow(
        '別時間足の足が混入しています',
      );
    });

    it('openTime 昇順でない確定足列を渡すとエラーになる', () => {
      // Given: index を逆順にした確定足列（openTime が降順）
      const descending = [104, 103, 102, 101, 100].map((v, i) =>
        candle(String(v), 4 - i, TimeFrame.ONE_MINUTE, 60_000),
      );

      // When / Then
      expect(() => book.warmUp(TimeFrame.ONE_MINUTE, descending)).toThrow(
        'openTime 昇順になっていません',
      );
    });
  });

  describe('reconcile()', () => {
    it('空の配列を渡すとエラーになる', () => {
      warmUpAll();
      expect(() => book.reconcile(TimeFrame.FIFTEEN_MINUTE, [])).toThrow(
        'reconcile に空の配列が渡されました',
      );
    });

    it('別時間足の足が混入しているとエラーになる', () => {
      // Given: 15分足を照合するのに1時間足が1本混ざった公式列
      warmUpAll();
      const mixed = [
        candle('105', 5, TimeFrame.FIFTEEN_MINUTE, 900_000),
        candle('106', 6, TimeFrame.ONE_HOUR, 3_600_000),
      ];

      // When / Then
      expect(() => book.reconcile(TimeFrame.FIFTEEN_MINUTE, mixed)).toThrow(
        '別時間足の足が混入しています',
      );
    });

    it('自前の足と公式列が一致していれば是正なし（null を返す）', () => {
      // Given: warmUp と同じ close 列をそのまま公式値として渡す
      warmUpAll();
      const official = warmUpData(TimeFrame.FIFTEEN_MINUTE, 900_000);

      // When
      const result = book.reconcile(TimeFrame.FIFTEEN_MINUTE, official);

      // Then
      expect(result).toBeNull();
    });

    it('公式列が自前とズレていれば是正され BarReconciled を返す', () => {
      // Given: warmUp 後、close を全体的にずらした公式列で照合
      warmUpAll();
      const official = [110, 111, 112, 113, 114].map((v, i) =>
        candle(String(v), i, TimeFrame.FIFTEEN_MINUTE, 900_000),
      );

      // When
      const result = book.reconcile(TimeFrame.FIFTEEN_MINUTE, official);

      // Then: 是正の事実が返り、是正後 SMA を持つ
      expect(result).not.toBeNull();
      expect(result!.timeFrame).toBe(TimeFrame.FIFTEEN_MINUTE);
      expect(result!.after).not.toBeNull();
    });

    it('公式足が SMA 再構築に不足するとき照合をスキップし null を返す', () => {
      // Given: LONG_PERIOD=5 に対し 3 本しか公式足が無い
      warmUpAll();
      const tooFew = [110, 111, 112].map((v, i) =>
        candle(String(v), i, TimeFrame.FIFTEEN_MINUTE, 900_000),
      );

      // When
      const result = book.reconcile(TimeFrame.FIFTEEN_MINUTE, tooFew);

      // Then: 照合不能としてスキップ（足も SMA も触らないので例外も出ない）
      expect(result).toBeNull();
    });

    it('公式列が openTime 昇順でないとエラーになる', () => {
      // Given: index を逆順にした公式列（openTime が降順）
      warmUpAll();
      const descending = [114, 113, 112, 111, 110].map((v, i) =>
        candle(String(v), 4 - i, TimeFrame.FIFTEEN_MINUTE, 900_000),
      );

      // When / Then
      expect(() => book.reconcile(TimeFrame.FIFTEEN_MINUTE, descending)).toThrow(
        'openTime 昇順になっていません',
      );
    });
  });

  describe('onTick() — 最初の tick', () => {
    it('warmUp 後の最初の tick で MarketSnapshot が返る', () => {
      // Given: 全時間足を warmUp
      warmUpAll();

      // When: 最初の tick
      const t = tick('105', '2024-01-20T10:00:30.000Z');
      const snapshot = book.onTick(t);

      // Then: MarketSnapshot が返る
      expect(snapshot).toBeDefined();
    });

    it('返された MarketSnapshot の tick が渡した tick と等しい', () => {
      // Given
      warmUpAll();

      // When
      const t = tick('105', '2024-01-20T10:00:30.000Z');
      const snapshot = book.onTick(t);

      // Then
      expect(snapshot.tick.equals(t)).toBe(true);
    });

    it('全 TimeFrame のスナップショットが取得できる', () => {
      // Given
      warmUpAll();

      // When
      const snapshot = book.onTick(tick('105', '2024-01-20T10:00:30.000Z'));

      // Then: 全 TimeFrame のスナップショットが存在する
      for (const tf of LIVE_TIMEFRAMES) {
        expect(() => snapshot.snapshotOf(tf)).not.toThrow();
      }
    });

    it('1分足スナップショットの confirmed は warmUp の最後の足', () => {
      // Given: warmUp（最後の足: close=104）
      warmUpAll();

      // When
      const snapshot = book.onTick(tick('105', '2024-01-20T10:00:30.000Z'));
      const oneMin = snapshot.snapshotOf(TimeFrame.ONE_MINUTE);

      // Then: confirmed.close = 104（warmUp の最後の足）
      expect(oneMin.confirmed.close.equals(Price.of('104'))).toBe(true);
    });

    it('1分足スナップショットの forming.currentClose が tick の bid', () => {
      // Given
      warmUpAll();

      // When: bid = 104.999
      const snapshot = book.onTick(tick('105', '2024-01-20T10:00:30.000Z'));
      const oneMin = snapshot.snapshotOf(TimeFrame.ONE_MINUTE);

      // Then
      expect(oneMin.forming.currentClose().equals(Price.of('104.999'))).toBe(true);
    });
  });

  describe('onTick() — 足の確定', () => {
    it('新しい1分間の tick で1分足が確定し、forming が更新される', () => {
      // Given: warmUp + 10:00 に最初の tick
      warmUpAll();
      book.onTick(tick('105', '2024-01-20T10:00:30.000Z'));

      // When: 10:01 の tick（新しい1分間 → 1分足が確定）
      const snapshot = book.onTick(tick('106', '2024-01-20T10:01:00.000Z'));

      // Then: confirmed の close は前の足の close（bid = 104.999）
      const oneMin = snapshot.snapshotOf(TimeFrame.ONE_MINUTE);
      expect(oneMin.confirmed.close.equals(Price.of('104.999'))).toBe(true);
    });

    it('足確定ログに確定 SMA の実値が含まれる（判断証跡）', () => {
      // Given: ログを観測できる book（EntryRule 側ではなくここが証跡の置き場所）
      const logPort = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const config = IndicatorConfig.of({ shortSmaPeriod: SHORT_PERIOD, longSmaPeriod: LONG_PERIOD });
      const loggingBook = new TimeFrameBook(CurrencyPair('USD_JPY'), config, factory, logPort);
      loggingBook.warmUp(TimeFrame.ONE_MINUTE, warmUpData(TimeFrame.ONE_MINUTE, 60_000));
      loggingBook.warmUp(TimeFrame.FIFTEEN_MINUTE, warmUpData(TimeFrame.FIFTEEN_MINUTE, 900_000));
      loggingBook.warmUp(TimeFrame.ONE_HOUR, warmUpData(TimeFrame.ONE_HOUR, 3_600_000));
      loggingBook.warmUp(TimeFrame.ONE_DAY, warmUpData(TimeFrame.ONE_DAY, 86_400_000));
      loggingBook.onTick(tick('105', '2024-01-20T10:00:30.000Z'));

      // When: 10:01 の tick で1分足が確定
      loggingBook.onTick(tick('106', '2024-01-20T10:01:00.000Z'));

      // Then: 確定ログのメッセージと data に確定 SMA の実値が入っている
      const confirmedCall = vi.mocked(logPort.info).mock.calls.find(
        ([message]) => (message as string).includes('1分足確定'),
      );
      expect(confirmedCall).toBeDefined();
      expect(confirmedCall![0]).toContain(`SMA(${SHORT_PERIOD})=`);
      expect(confirmedCall![0]).toContain(`SMA(${LONG_PERIOD})=`);
      const data = confirmedCall![1] as Record<string, unknown>;
      // 確定直後の値であること（1本古い SMA なら 103）: SMA(3) of [103, 104, 104.999] ≈ 103.999...
      expect(String(data.smaShort)).toMatch(/^103\.999/);
      // prev は確定前の値: SMA(3) of [102, 103, 104] = 103
      expect(data.prevSmaShort).toBe('103');
      expect(data.smaLong).toBeDefined();
      expect(data.prevSmaLong).toBeDefined();
    });

    it('1分足確定後も1時間足は confirmed が変わらない（warmUp の最後の足のまま）', () => {
      // Given
      warmUpAll();
      book.onTick(tick('105', '2024-01-20T10:00:30.000Z'));

      // When: 1分足が確定するが、1時間足はまだ
      const snapshot = book.onTick(tick('106', '2024-01-20T10:01:00.000Z'));

      // Then: 1時間足の confirmed は warmUp の最後（close=104）
      const oneHour = snapshot.snapshotOf(TimeFrame.ONE_HOUR);
      expect(oneHour.confirmed.close.equals(Price.of('104'))).toBe(true);
    });
  });

  describe('onTick() — 指標値の確認', () => {
    it('warmUp 後の confirmed.shortSma が期待値と一致', () => {
      // Given: warmUp で SMA(3) = (102+103+104)/3 = 103
      warmUpAll();

      // When
      const snapshot = book.onTick(tick('105', '2024-01-20T10:00:30.000Z'));
      const indicators = snapshot.snapshotOf(TimeFrame.ONE_MINUTE).indicators;

      // Then: confirmed shortSma = 103
      expect(indicators.confirmed.shortSma.toString()).toBe('103');
    });

    it('1分足確定後に confirmed.shortSma が更新される', () => {
      // Given: warmUp → 10:00 tick (bid=104.999)
      warmUpAll();
      book.onTick(tick('105', '2024-01-20T10:00:30.000Z'));

      // When: 10:01 tick で1分足確定（確定足 close=104.999）
      const snapshot = book.onTick(tick('106', '2024-01-20T10:01:00.000Z'));
      const indicators = snapshot.snapshotOf(TimeFrame.ONE_MINUTE).indicators;

      // Then: SMA(3) of [103, 104, 104.999] ≈ 103.99966...
      const smaValue = parseFloat(indicators.confirmed.shortSma.toString());
      expect(smaValue).toBeCloseTo((103 + 104 + 104.999) / 3, 4);
    });

    it('forming の shortSma が tick の close を反映する', () => {
      // Given: warmUp → confirmed shortSma current = 103
      warmUpAll();

      // When: midPrice = 200（大きな値）を入れると forming SMA が変わる
      const snapshot = book.onTick(tick('200', '2024-01-20T10:00:30.000Z'));
      const indicators = snapshot.snapshotOf(TimeFrame.ONE_MINUTE).indicators;

      // Then: forming.shortSma ≠ confirmed.shortSma
      expect(indicators.forming.shortSma.toString()).not.toBe(
        indicators.confirmed.shortSma.toString(),
      );
    });
  });

  describe('onTick() — 複数 tick のシーケンス', () => {
    it('3本の tick を流して正しい MarketSnapshot が返る', () => {
      // Given
      warmUpAll();

      // When: 3本の tick を同じ1分間で流す
      book.onTick(tick('105', '2024-01-20T10:00:10.000Z'));
      book.onTick(tick('106', '2024-01-20T10:00:20.000Z'));
      const snapshot = book.onTick(tick('107', '2024-01-20T10:00:30.000Z'));

      // Then: forming の close が最新 tick の bid
      const oneMin = snapshot.snapshotOf(TimeFrame.ONE_MINUTE);
      expect(oneMin.forming.currentClose().equals(Price.of('106.999'))).toBe(true);
    });
  });

  describe('1時間足の確定', () => {
    it('次の時間帯の tick で1時間足が確定する', () => {
      // Given: warmUp + 10:00 に tick
      warmUpAll();
      book.onTick(tick('105', '2024-01-20T10:00:30.000Z'));

      // When: 11:00 の tick（次の時間帯 → 1時間足が確定）
      const snapshot = book.onTick(tick('110', '2024-01-20T11:00:00.000Z'));

      // Then: 1時間足の confirmed close が前の時間帯の tick の bid
      const oneHour = snapshot.snapshotOf(TimeFrame.ONE_HOUR);
      expect(oneHour.confirmed.close.equals(Price.of('104.999'))).toBe(true);
    });
  });

  describe('確定後の forming SMA リセット', () => {
    it('1分足確定後に forming SMA が新しい足の bid を反映する', () => {
      // Given: warmUp + 10:00 tick
      warmUpAll();
      book.onTick(tick('105', '2024-01-20T10:00:30.000Z'));

      // When: 10:01 tick で確定 → forming は新しい足 (close=106)
      const snapshot = book.onTick(tick('106', '2024-01-20T10:01:00.000Z'));
      const indicators = snapshot.snapshotOf(TimeFrame.ONE_MINUTE).indicators;

      // Then: forming.previousShortSma は確定後の confirmed.shortSma と一致
      expect(indicators.forming.previousShortSma.toString()).toBe(
        indicators.confirmed.shortSma.toString(),
      );

      // forming.shortSma は新しい足の close を含んだ仮計算値で、
      // confirmed.shortSma とは異なる
      expect(indicators.forming.shortSma.toString()).not.toBe(
        indicators.confirmed.shortSma.toString(),
      );
    });
  });

  describe('warmUp 未完了のエラー', () => {
    it('一部の時間足だけ warmUp して onTick() を呼ぶとエラーになる', () => {
      // Given: 1分足だけ warmUp
      book.warmUp(TimeFrame.ONE_MINUTE, warmUpData(TimeFrame.ONE_MINUTE, 60_000));

      // When / Then: 他の時間足の SMA が安定していないのでエラー
      expect(() => book.onTick(tick('105', '2024-01-20T10:00:30.000Z'))).toThrow();
    });
  });
});
