import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { TimeFrame, LIVE_TIMEFRAMES, isAlignedToTimeFrame, durationMs } from '@luchida/backend/domain/market/TimeFrame.js';
import { Price } from '@luchida/backend/domain/market/Price.js';
import { Tick } from '@luchida/backend/domain/market/tick/Tick.js';
import { Timestamp } from '@luchida/backend/domain/market/Timestamp.js';
import { ConfirmedCandle } from '@luchida/backend/domain/market/candle/ConfirmedCandle.js';
import { CandleOpenTime } from '@luchida/backend/domain/market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '@luchida/backend/domain/market/candle/CandleCloseTime.js';
import { FormingCandle } from '@luchida/backend/domain/market/candle/FormingCandle.js';
import { MarketSnapshot } from '@luchida/backend/domain/market/snapshot/MarketSnapshot.js';
import { TimeFrameSnapshot } from '@luchida/backend/domain/market/snapshot/TimeFrameSnapshot.js';
import { IndicatorLedger } from '@luchida/backend/domain/market/indicator/IndicatorLedger.js';
import { IndicatorValues } from '@luchida/backend/domain/market/indicator/IndicatorValues.js';
import { SmaSnapshot } from '@luchida/backend/domain/market/indicator/SmaSnapshot.js';
import { SmaValue } from '@luchida/backend/domain/market/indicator/SmaValue.js';
import type { TimeFrameIndicatorSpec } from '@luchida/backend/domain/market/indicator/TimeFrameIndicatorSpec.js';
import type { SmaCalculatorFactory } from '@luchida/backend/domain/market/indicator/SmaCalculator.js';
import type { SnapshotAdapter } from './SnapshotAdapter.js';

/**
 * 1 timeframe 分の状態（IndicatorLedger + 直近確定足）。
 */
interface TimeFrameState {
  readonly spec: TimeFrameIndicatorSpec;
  readonly ledger: IndicatorLedger;
  lastConfirmed: ConfirmedCandle | null;
  /** この timeframe 用の確定足キュー（signal timeframe 以外で使う、warmUp 時にセット） */
  upcomingConfirms: ConfirmedCandle[];
}

/**
 * BT のデータを MarketSnapshot に変換する multi-timeframe 対応アダプタ。
 *
 * 設計方針:
 * - signalTimeFrame（駆動足）の確定で snapshot を生成する
 * - 他 timeframe の確定足キュー（upcomingConfirms）から、駆動足の openTime に整列したものを順次取り出す
 * - 各 timeframe について IndicatorLedger を持ち、独立に SMA を計算する
 * - LIVE_TIMEFRAMES のうち specs に含まれない timeframe はダミー TimeFrameSnapshot で埋める
 *   （MarketSnapshot.of() のバリデーションを満たすため。Rule は snapshotOf(targetTimeFrame) で
 *   対象 timeframe のみ参照するため、ダミーが判定に影響することはない）
 */
export class BacktestSnapshotAdapter implements SnapshotAdapter {
  private readonly states: Map<TimeFrame, TimeFrameState>;
  private warmedUp: boolean = false;

  constructor(
    private readonly pair: CurrencyPair,
    private readonly signalTimeFrame: TimeFrame,
    specs: ReadonlyArray<TimeFrameIndicatorSpec>,
    smaCalculatorFactory: SmaCalculatorFactory,
  ) {
    if (!specs.some(s => s.timeFrame === signalTimeFrame)) {
      throw new Error(
        `BacktestSnapshotAdapter: specs に signalTimeFrame が含まれていません: ${signalTimeFrame}`,
      );
    }
    const states = new Map<TimeFrame, TimeFrameState>();
    for (const spec of specs) {
      if (states.has(spec.timeFrame)) {
        throw new Error(`BacktestSnapshotAdapter: timeFrame が重複: ${spec.timeFrame}`);
      }
      states.set(spec.timeFrame, {
        spec,
        ledger: new IndicatorLedger(spec.shortPeriod, spec.longPeriod, smaCalculatorFactory),
        lastConfirmed: null,
        upcomingConfirms: [],
      });
    }
    this.states = states;
  }

  /**
   * 既存テストとシンプルなユースケースのための後方互換ファクトリ。
   * 単一 timeframe で従来通りの動作。
   */
  static singleTimeFrame(
    pair: CurrencyPair,
    timeFrame: TimeFrame,
    shortPeriod: number,
    longPeriod: number,
    smaCalculatorFactory: SmaCalculatorFactory,
  ): BacktestSnapshotAdapter {
    return new BacktestSnapshotAdapter(
      pair,
      timeFrame,
      [{ timeFrame, shortPeriod, longPeriod }],
      smaCalculatorFactory,
    );
  }

  /**
   * 駆動足（signalTimeFrame）の warmUp 確定足を渡す。
   * 単一 timeframe 構成の従来挙動を維持するための互換 API。
   * multi-tf 構成では warmUpAll() を使う。
   */
  warmUp(confirmedCandles: ReadonlyArray<ConfirmedCandle>): void {
    this.warmUpAll(new Map([[this.signalTimeFrame, confirmedCandles]]));
  }

  /**
   * 各 timeframe の warmUp 確定足を一括で渡す。
   * - 渡された timeframe は ledger を warmUp する
   * - signalTimeFrame 以外の timeframe について、warmUp 直後に続く確定足を upcomingConfirms に積む
   *   （実際の運用では「warmUp と本番ループで使う confirmedCandles を分けて渡す」のが理想だが、
   *   現状は warmUp 用と運用用を別々にユーザーが管理する）
   */
  warmUpAll(confirmedCandlesByTf: ReadonlyMap<TimeFrame, ReadonlyArray<ConfirmedCandle>>): void {
    for (const [tf, state] of this.states) {
      const candles = confirmedCandlesByTf.get(tf);
      if (candles && candles.length > 0) {
        state.ledger.warmUp(Array.from(candles));
        state.lastConfirmed = candles[candles.length - 1]!;
      }
    }
    this.warmedUp = true;
  }

  /**
   * 駆動足以外の timeframe について、本番ループ中に投入される確定足キューをセットする。
   * OhlcEngine が事前に取得した「メイン期間の確定足」を timeframe ごとに渡す。
   */
  setUpcomingConfirmsByTimeFrame(map: ReadonlyMap<TimeFrame, ReadonlyArray<ConfirmedCandle>>): void {
    for (const [tf, state] of this.states) {
      if (tf === this.signalTimeFrame) continue;
      const candles = map.get(tf);
      if (!candles || candles.length === 0) continue;
      // 安全装置: upcoming 先頭は warmup 末尾より後（時系列順が守られている）こと
      // FX 市場の週末閉場により 1 足ぶんピッタリの連続性は保証されないが、
      // 「過去方向」に戻ることはデータ破損の兆候
      if (state.lastConfirmed) {
        const warmupEndMs = state.lastConfirmed.openTime.toDate().getTime();
        const upcomingStartMs = candles[0]!.openTime.toDate().getTime();
        if (upcomingStartMs <= warmupEndMs) {
          throw new Error(
            `BacktestSnapshotAdapter: ${tf} の upcoming 先頭が warmup 末尾以前。`
              + ` warmup末尾 ${new Date(warmupEndMs).toISOString()} / upcoming先頭 ${new Date(upcomingStartMs).toISOString()}`,
          );
        }
      }
      state.upcomingConfirms = Array.from(candles);
    }
  }

  addCandleAndBuild(
    newCandle: ConfirmedCandle,
    latestTick: Tick,
    nextCandleOpen: Price,
  ): MarketSnapshot {
    if (!this.warmedUp) {
      throw new Error('BacktestSnapshotAdapter: warmUp() を先に呼んでください');
    }

    // 1. 駆動足（signalTimeFrame）を更新
    const signalState = this.states.get(this.signalTimeFrame)!;
    signalState.ledger.onCandleConfirmed(newCandle);
    signalState.lastConfirmed = newCandle;
    const signalForming = this.makeFormingFromOpen(nextCandleOpen, latestTick, this.signalTimeFrame);
    signalState.ledger.onCandleUpdated(signalForming);

    // 2. 上位足の確定タイミングを処理
    // 駆動足の closeTime（= 次足の openTime）が他 timeframe の境界に整列していたら、
    // その timeframe について「直前の確定足を 1 本確定」する
    const nextOpenTime = new Date(newCandle.closeTime.toDate().getTime());
    for (const [tf, state] of this.states) {
      if (tf === this.signalTimeFrame) continue;
      // 「次足 openTime が tf に整列」= この駆動足の確定で tf 足も確定したタイミング
      if (isAlignedToTimeFrame(nextOpenTime, tf)) {
        // 期待される上位足の openTime（= ちょうど確定した 1 本）
        const expectedOpenMs = nextOpenTime.getTime() - durationMs(tf);
        // upcoming 先頭の openTime とタイムラインを整合させる
        // - 一致: shift して confirm
        // - 先頭が未来: 該当時刻の上位足は DB に存在しない（市場閉場等）→ shift しない
        // - 先頭が過去: 過去の足が残っている（駆動足と上位足のバケット生成タイミングのズレ）→ 捨てて進める
        while (state.upcomingConfirms.length > 0) {
          const headMs = state.upcomingConfirms[0]!.openTime.toDate().getTime();
          if (headMs === expectedOpenMs) {
            const next = state.upcomingConfirms.shift()!;
            state.ledger.onCandleConfirmed(next);
            state.lastConfirmed = next;
            break;
          }
          if (headMs > expectedOpenMs) break;
          state.upcomingConfirms.shift();
        }
      }
      // forming 更新（駆動足の close を反映 — 形成中の上位足の暫定 close）
      if (state.lastConfirmed) {
        const forming = this.makeFormingFromCandle(state.lastConfirmed, latestTick, tf);
        state.ledger.onCandleUpdated(forming);
      }
    }

    // 3. 全 timeframe の TimeFrameSnapshot を構築
    const timeFrames = new Map<TimeFrame, TimeFrameSnapshot>();
    for (const tf of LIVE_TIMEFRAMES) {
      const state = this.states.get(tf);
      if (state && state.lastConfirmed) {
        const confirmed = state.lastConfirmed;
        const forming = tf === this.signalTimeFrame
          ? signalForming
          : this.makeFormingFromCandle(confirmed, latestTick, tf);
        const indicators = state.ledger.currentValues();
        timeFrames.set(tf, TimeFrameSnapshot.of({ timeFrame: tf, confirmed, forming, indicators }));
      } else {
        timeFrames.set(tf, this.makeDummyTimeFrameSnapshot(tf, newCandle, latestTick));
      }
    }

    return MarketSnapshot.of({
      timeFrames,
      tick: latestTick,
      pair: this.pair,
      capturedAt: Timestamp.of(latestTick.timestamp().toDate()),
    });
  }

  private makeFormingFromOpen(
    nextCandleOpen: Price,
    latestTick: Tick,
    tf: TimeFrame,
  ): FormingCandle {
    const openNum = Number(nextCandleOpen.toString());
    const spread = 0.0005;
    const tick = Tick.of(
      Price.of((openNum + spread).toFixed(6)),
      Price.of((openNum - spread).toFixed(6)),
      latestTick.timestamp(),
    );
    return FormingCandle.open(tick, tf);
  }

  /**
   * 上位足 forming 用: 直近確定足の close を仮 forming として表現する。
   * 確定 1h 足の上に「次の 1h 足の暫定 forming」を作り、まだ tick が来ていない状態を表す。
   */
  private makeFormingFromCandle(
    base: ConfirmedCandle,
    latestTick: Tick,
    tf: TimeFrame,
  ): FormingCandle {
    const closeNum = Number(base.close.toString());
    const spread = 0.0005;
    const tick = Tick.of(
      Price.of((closeNum + spread).toFixed(6)),
      Price.of((closeNum - spread).toFixed(6)),
      latestTick.timestamp(),
    );
    return FormingCandle.open(tick, tf);
  }

  private makeDummyTimeFrameSnapshot(
    tf: TimeFrame,
    sourceCandle: ConfirmedCandle,
    tick: Tick,
  ): TimeFrameSnapshot {
    const dummyConfirmed = ConfirmedCandle.of({
      open: sourceCandle.open,
      high: sourceCandle.high,
      low: sourceCandle.low,
      close: sourceCandle.close,
      openTime: CandleOpenTime.of(this.alignDownTo(sourceCandle.openTime.toDate(), tf)),
      closeTime: CandleCloseTime.of(new Date(this.alignDownTo(sourceCandle.openTime.toDate(), tf).getTime() + durationMs(tf) - 1)),
      timeFrame: tf,
    });
    const dummyForming = FormingCandle.open(tick, tf);
    const closeStr = sourceCandle.close.toString();
    const dummySma = SmaSnapshot.of({
      shortSma: SmaValue.of(closeStr),
      longSma: SmaValue.of(closeStr),
      previousShortSma: SmaValue.of(closeStr),
      previousLongSma: SmaValue.of(closeStr),
    });
    return TimeFrameSnapshot.of({
      timeFrame: tf,
      confirmed: dummyConfirmed,
      forming: dummyForming,
      indicators: IndicatorValues.of(dummySma, dummySma),
    });
  }

  private alignDownTo(time: Date, tf: TimeFrame): Date {
    const d = durationMs(tf);
    return new Date(Math.floor(time.getTime() / d) * d);
  }
}
