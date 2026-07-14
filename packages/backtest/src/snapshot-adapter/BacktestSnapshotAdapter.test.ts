import { describe, it, expect } from 'vitest';

import { TimeFrame, LIVE_TIMEFRAMES } from '@luchida/backend/domain/market/TimeFrame.js';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { Price } from '@luchida/backend/domain/market/Price.js';
import { Tick } from '@luchida/backend/domain/market/tick/Tick.js';
import { TickTimestamp } from '@luchida/backend/domain/market/tick/TickTimestamp.js';
import { ConfirmedCandle } from '@luchida/backend/domain/market/candle/ConfirmedCandle.js';
import { CandleOpenTime } from '@luchida/backend/domain/market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '@luchida/backend/domain/market/candle/CandleCloseTime.js';

import { BacktestSnapshotAdapter } from './BacktestSnapshotAdapter.js';
import { BacktestSmaCalculatorFactory } from './BacktestSmaCalculatorFactory.js';

const SHORT_PERIOD = 3;
const LONG_PERIOD = 5;
const pair = CurrencyPair('USD_JPY');
const tf = TimeFrame.FIFTEEN_MINUTE;

function makeCandles(count: number, basePrice: number): ConfirmedCandle[] {
  const candles: ConfirmedCandle[] = [];
  const baseTime = new Date('2024-01-01T00:00:00Z');
  for (let i = 0; i < count; i++) {
    const close = basePrice + i * 0.01;
    const openMs = baseTime.getTime() + i * 900_000;
    candles.push(
      ConfirmedCandle.of({
        open: Price.of(close.toFixed(3)),
        high: Price.of((close + 0.005).toFixed(3)),
        low: Price.of((close - 0.005).toFixed(3)),
        close: Price.of(close.toFixed(3)),
        openTime: CandleOpenTime.of(new Date(openMs)),
        closeTime: CandleCloseTime.of(new Date(openMs + 900_000)),
        timeFrame: tf,
      }),
    );
  }
  return candles;
}

function makeTick(askStr: string, bidStr: string): Tick {
  return Tick.of(
    Price.of(askStr),
    Price.of(bidStr),
    TickTimestamp.of(new Date('2024-01-01T03:00:00Z')),
  );
}

describe('BacktestSnapshotAdapter', () => {
  const factory = new BacktestSmaCalculatorFactory();

  it('warmUp + addCandleAndBuild が MarketSnapshot を正常に返す', () => {
    const adapter = BacktestSnapshotAdapter.singleTimeFrame(pair, tf, SHORT_PERIOD, LONG_PERIOD, factory);
    const candles = makeCandles(10, 150);
    const tick = makeTick('150.120', '150.100');

    adapter.warmUp(candles.slice(0, -1));
    const snapshot = adapter.addCandleAndBuild(candles[candles.length - 1]!, tick, Price.of('150.110'));

    expect(snapshot).toBeDefined();
    expect(snapshot.pair).toBe('USD_JPY');
  });

  it('対象 TimeFrame の confirmed が addCandleAndBuild で渡した足と一致する', () => {
    const adapter = BacktestSnapshotAdapter.singleTimeFrame(pair, tf, SHORT_PERIOD, LONG_PERIOD, factory);
    const candles = makeCandles(10, 150);
    const lastCandle = candles[candles.length - 1]!;
    const tick = makeTick('150.120', '150.100');

    adapter.warmUp(candles.slice(0, -1));
    const snapshot = adapter.addCandleAndBuild(lastCandle, tick, Price.of('150.110'));
    const tfSnapshot = snapshot.snapshotOf(tf);

    expect(tfSnapshot.confirmed.close.toString()).toBe(lastCandle.close.toString());
    expect(tfSnapshot.confirmed.openTime.toDate().getTime()).toBe(
      lastCandle.openTime.toDate().getTime(),
    );
  });

  it('IndicatorValues（SMA）が確定足列から計算されている', () => {
    const adapter = BacktestSnapshotAdapter.singleTimeFrame(pair, tf, SHORT_PERIOD, LONG_PERIOD, factory);
    const candles = makeCandles(10, 150);
    const tick = makeTick('150.120', '150.100');

    adapter.warmUp(candles.slice(0, -1));
    const snapshot = adapter.addCandleAndBuild(candles[candles.length - 1]!, tick, Price.of('150.110'));
    const indicators = snapshot.snapshotOf(tf).indicators;

    expect(indicators.confirmed).toBeDefined();
    expect(indicators.forming).toBeDefined();
    expect(Number(indicators.confirmed.shortSma.toString())).toBeGreaterThan(0);
    expect(Number(indicators.confirmed.longSma.toString())).toBeGreaterThan(0);
  });

  it('LIVE_TIMEFRAMES の全4種が Map に含まれる', () => {
    const adapter = BacktestSnapshotAdapter.singleTimeFrame(pair, tf, SHORT_PERIOD, LONG_PERIOD, factory);
    const candles = makeCandles(10, 150);
    const tick = makeTick('150.120', '150.100');

    adapter.warmUp(candles.slice(0, -1));
    const snapshot = adapter.addCandleAndBuild(candles[candles.length - 1]!, tick, Price.of('150.110'));

    for (const liveTf of LIVE_TIMEFRAMES) {
      expect(() => snapshot.snapshotOf(liveTf)).not.toThrow();
    }
  });

  it('連続 addCandleAndBuild で差分のみ処理される', () => {
    const adapter = BacktestSnapshotAdapter.singleTimeFrame(pair, tf, SHORT_PERIOD, LONG_PERIOD, factory);
    const candles = makeCandles(11, 150);
    const tick = makeTick('150.120', '150.100');

    adapter.warmUp(candles.slice(0, 8));
    const snap1 = adapter.addCandleAndBuild(candles[8]!, tick, Price.of('150.100'));
    // 中間呼び出し（状態を進めるだけ。検証は snap1 / snap3 で行う）
    adapter.addCandleAndBuild(candles[9]!, tick, Price.of('150.110'));
    const snap3 = adapter.addCandleAndBuild(candles[10]!, tick, Price.of('150.120'));

    // 各 snapshot の confirmed が対応する足と一致
    expect(snap1.snapshotOf(tf).confirmed.close.toString()).toBe(candles[8]!.close.toString());
    expect(snap3.snapshotOf(tf).confirmed.close.toString()).toBe(candles[10]!.close.toString());

    // SMA 値が各呼び出しで異なる
    const sma1 = Number(snap1.snapshotOf(tf).indicators.confirmed.shortSma.toString());
    const sma3 = Number(snap3.snapshotOf(tf).indicators.confirmed.shortSma.toString());
    expect(sma3).not.toBe(sma1);
  });

  // ===================== multi-timeframe 検証 =====================

  /** 指定時刻から N 本ぶんの 15分足を作る（連続） */
  function makeM15Candles(startIso: string, count: number, basePrice: number): ConfirmedCandle[] {
    const result: ConfirmedCandle[] = [];
    const baseMs = new Date(startIso).getTime();
    for (let i = 0; i < count; i++) {
      const openMs = baseMs + i * 900_000;
      const p = basePrice + i * 0.01;
      result.push(ConfirmedCandle.of({
        open: Price.of(p.toFixed(3)), high: Price.of((p + 0.005).toFixed(3)),
        low: Price.of((p - 0.005).toFixed(3)), close: Price.of(p.toFixed(3)),
        openTime: CandleOpenTime.of(new Date(openMs)),
        closeTime: CandleCloseTime.of(new Date(openMs + 900_000)),
        timeFrame: TimeFrame.FIFTEEN_MINUTE,
      }));
    }
    return result;
  }

  /** 指定 openTime の 1h 足を作る */
  function makeH1Candle(openIso: string, closePrice: number): ConfirmedCandle {
    const openMs = new Date(openIso).getTime();
    return ConfirmedCandle.of({
      open: Price.of((closePrice - 0.02).toFixed(3)), high: Price.of((closePrice + 0.01).toFixed(3)),
      low: Price.of((closePrice - 0.03).toFixed(3)), close: Price.of(closePrice.toFixed(3)),
      openTime: CandleOpenTime.of(new Date(openMs)),
      closeTime: CandleCloseTime.of(new Date(openMs + 3_600_000)),
      timeFrame: TimeFrame.ONE_HOUR,
    });
  }

  describe('multi-timeframe: 週末スキップ・データ欠損時の shift 整合性', () => {
    it('1h 足の期待 openTime と upcoming 先頭が一致するときだけ shift する（look-ahead 防止）', () => {
      // 駆動足 15分 × 12本 (= 3h ぶん), 上位足 1h × 3 本分を想定
      // 15分足: 10:00 〜 13:00
      // 1h 足:  10:00-11:00, 11:00-12:00, 12:00-13:00
      const warmupM15 = makeM15Candles('2024-01-01T07:00:00Z', 10, 150); // SMA long=5 に十分
      const mainM15 = makeM15Candles('2024-01-01T10:00:00Z', 12, 151);
      const warmupH1 = [
        makeH1Candle('2024-01-01T07:00:00Z', 150.50),
        makeH1Candle('2024-01-01T08:00:00Z', 150.60),
        makeH1Candle('2024-01-01T09:00:00Z', 150.70),
      ];
      const mainH1 = [
        makeH1Candle('2024-01-01T10:00:00Z', 150.80),
        makeH1Candle('2024-01-01T11:00:00Z', 150.90),
        makeH1Candle('2024-01-01T12:00:00Z', 151.00),
      ];

      const adapter = new BacktestSnapshotAdapter(
        pair, TimeFrame.FIFTEEN_MINUTE,
        [
          { timeFrame: TimeFrame.FIFTEEN_MINUTE, shortPeriod: 3, longPeriod: 5 },
          { timeFrame: TimeFrame.ONE_HOUR, shortPeriod: 2, longPeriod: 3 },
        ],
        factory,
      );
      adapter.warmUpAll(new Map<TimeFrame, ConfirmedCandle[]>([
        [TimeFrame.FIFTEEN_MINUTE, warmupM15],
        [TimeFrame.ONE_HOUR, warmupH1],
      ]));
      adapter.setUpcomingConfirmsByTimeFrame(new Map([
        [TimeFrame.ONE_HOUR, mainH1],
      ]));

      const tick = makeTick('151.005', '151.000');

      // イテレーション 0: 10:00-10:15 確定 → nextOpenTime = 10:15 → 1h境界でない → 1h 未 shift
      // 10:00 時点の 1h confirmed は warmup 末尾 09:00-10:00
      const snap0 = adapter.addCandleAndBuild(mainM15[0]!, tick, Price.of('151.01'));
      expect(snap0.snapshotOf(TimeFrame.ONE_HOUR).confirmed.close.toString()).toBe('150.7');

      // イテレーション 1,2: 10:15, 10:30 → どちらも 1h 境界でない
      adapter.addCandleAndBuild(mainM15[1]!, tick, Price.of('151.02'));
      adapter.addCandleAndBuild(mainM15[2]!, tick, Price.of('151.03'));

      // イテレーション 3: 10:45-11:00 確定 → nextOpenTime = 11:00 → 1h 境界 → shift
      // 期待: 10:00-11:00 の 1h 足が confirmed になる
      const snap3 = adapter.addCandleAndBuild(mainM15[3]!, tick, Price.of('151.04'));
      expect(snap3.snapshotOf(TimeFrame.ONE_HOUR).confirmed.close.toString()).toBe('150.8');

      // イテレーション 7: 11:45-12:00 → nextOpenTime = 12:00 → shift → 11:00-12:00 が confirmed
      for (let i = 4; i <= 6; i++) adapter.addCandleAndBuild(mainM15[i]!, tick, Price.of('151.05'));
      const snap7 = adapter.addCandleAndBuild(mainM15[7]!, tick, Price.of('151.06'));
      expect(snap7.snapshotOf(TimeFrame.ONE_HOUR).confirmed.close.toString()).toBe('150.9');
    });

    it('期待 openTime に対応する 1h 足が upcoming に無い場合（週末スキップ）、shift せず古い SMA を維持する', () => {
      // シナリオ: 10:45-11:00 確定で expected 10:00-11:00 の 1h 足を求めるが、upcoming には 11:00-12:00 と 12:00-13:00 しかない
      // → 10:45 時点では shift せず、warmup 末尾の 1h 足 09:00-10:00 を維持すべき
      const warmupM15 = makeM15Candles('2024-01-01T07:00:00Z', 10, 150);
      const mainM15 = makeM15Candles('2024-01-01T10:00:00Z', 8, 151);
      const warmupH1 = [
        makeH1Candle('2024-01-01T07:00:00Z', 150.50),
        makeH1Candle('2024-01-01T08:00:00Z', 150.60),
        makeH1Candle('2024-01-01T09:00:00Z', 150.70),
      ];
      // 10:00-11:00 の 1h 足だけ「欠損」
      const mainH1 = [
        makeH1Candle('2024-01-01T11:00:00Z', 150.90),
        makeH1Candle('2024-01-01T12:00:00Z', 151.00),
      ];

      const adapter = new BacktestSnapshotAdapter(
        pair, TimeFrame.FIFTEEN_MINUTE,
        [
          { timeFrame: TimeFrame.FIFTEEN_MINUTE, shortPeriod: 3, longPeriod: 5 },
          { timeFrame: TimeFrame.ONE_HOUR, shortPeriod: 2, longPeriod: 3 },
        ],
        factory,
      );
      adapter.warmUpAll(new Map<TimeFrame, ConfirmedCandle[]>([
        [TimeFrame.FIFTEEN_MINUTE, warmupM15],
        [TimeFrame.ONE_HOUR, warmupH1],
      ]));
      adapter.setUpcomingConfirmsByTimeFrame(new Map([
        [TimeFrame.ONE_HOUR, mainH1],
      ]));

      const tick = makeTick('151.005', '151.000');

      for (let i = 0; i < 3; i++) adapter.addCandleAndBuild(mainM15[i]!, tick, Price.of('151.01'));
      // 10:45-11:00 確定 → expected 10:00-11:00 → upcoming 先頭 11:00-12:00（未来）→ shift しない
      const snap3 = adapter.addCandleAndBuild(mainM15[3]!, tick, Price.of('151.04'));
      // 1h confirmed は warmup 末尾 09:00-10:00 のまま（future leak なし）
      expect(snap3.snapshotOf(TimeFrame.ONE_HOUR).confirmed.close.toString()).toBe('150.7');

      // 11:45-12:00 確定 → expected 11:00-12:00 → upcoming 先頭 11:00-12:00 → shift
      for (let i = 4; i <= 6; i++) adapter.addCandleAndBuild(mainM15[i]!, tick, Price.of('151.05'));
      const snap7 = adapter.addCandleAndBuild(mainM15[7]!, tick, Price.of('151.06'));
      expect(snap7.snapshotOf(TimeFrame.ONE_HOUR).confirmed.close.toString()).toBe('150.9');
    });

    it('upcoming 先頭が warmup 末尾以前だと throw（時系列逆戻りの検出）', () => {
      const adapter = new BacktestSnapshotAdapter(
        pair, TimeFrame.FIFTEEN_MINUTE,
        [
          { timeFrame: TimeFrame.FIFTEEN_MINUTE, shortPeriod: 3, longPeriod: 5 },
          { timeFrame: TimeFrame.ONE_HOUR, shortPeriod: 2, longPeriod: 3 },
        ],
        factory,
      );
      adapter.warmUpAll(new Map<TimeFrame, ConfirmedCandle[]>([
        [TimeFrame.FIFTEEN_MINUTE, makeM15Candles('2024-01-01T07:00:00Z', 10, 150)],
        [TimeFrame.ONE_HOUR, [
          makeH1Candle('2024-01-01T07:00:00Z', 150.50),
          makeH1Candle('2024-01-01T08:00:00Z', 150.60),
          makeH1Candle('2024-01-01T09:00:00Z', 150.70),
        ]],
      ]));

      // upcoming 先頭が warmup 末尾 (09:00) と同時刻 → throw
      expect(() => adapter.setUpcomingConfirmsByTimeFrame(new Map([
        [TimeFrame.ONE_HOUR, [makeH1Candle('2024-01-01T09:00:00Z', 150.99)]],
      ]))).toThrow(/warmup 末尾以前/);
    });
  });

  describe('multi-timeframe: 本番 TimeFrameBook との数値整合', () => {
    // 本番 TimeFrameBook は tick から足を組むが、Adapter は確定足を直接入れる。
    // 同じ確定足データを両方に食わせれば、IndicatorLedger.onCandleConfirmed が同じシーケンスで呼ばれ、
    // confirmed SMA の値は完全一致する。ここでは「adapter に単一 tf で食わせた SMA」が
    // 「IndicatorLedger を直接叩いた SMA」と一致することで、足運びの等価性を担保する。
    it('単一 tf の Adapter 出力が IndicatorLedger 直叩きの出力と一致する', async () => {
      const { IndicatorLedger } = await import('@luchida/backend/domain/market/indicator/IndicatorLedger.js');
      const candles = makeCandles(20, 150);

      const adapter = BacktestSnapshotAdapter.singleTimeFrame(pair, tf, SHORT_PERIOD, LONG_PERIOD, factory);
      adapter.warmUp(candles.slice(0, 10));

      const ledger = new IndicatorLedger(SHORT_PERIOD, LONG_PERIOD, factory);
      ledger.warmUp(candles.slice(0, 10));

      const tick = makeTick('150.120', '150.100');
      for (let i = 10; i < candles.length; i++) {
        const snap = adapter.addCandleAndBuild(candles[i]!, tick, Price.of(candles[i]!.close.toString()));
        ledger.onCandleConfirmed(candles[i]!);
        // addCandleAndBuild は内部で forming も更新するので confirmed のみ比較
        const adapterSma = snap.snapshotOf(tf).indicators.confirmed.shortSma.toString();
        const ledgerSma = ledger.currentValues().confirmed.shortSma.toString();
        expect(adapterSma).toBe(ledgerSma);
      }
    });
  });
});
