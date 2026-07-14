import { describe, expect, it } from 'vitest';
import { Price } from '../Price.js';
import { Tick } from '../tick/Tick.js';
import { TickTimestamp } from '../tick/TickTimestamp.js';
import { TimeFrame } from '../TimeFrame.js';
import { CandleCloseTime } from './CandleCloseTime.js';
import { CandleOpenTime } from './CandleOpenTime.js';
import { FormingCandle } from './FormingCandle.js';

// ---- テストヘルパー ----

const tickAt = (mid: string, date: Date) => {
  const ask = Price.of((parseFloat(mid) + 0.001).toFixed(3));
  const bid = Price.of((parseFloat(mid) - 0.001).toFixed(3));
  return Tick.of(ask, bid, TickTimestamp.of(date));
};

const tick = (mid: string) => tickAt(mid, new Date());

const closeTime = (offsetMs = 60_000) =>
  CandleCloseTime.of(new Date(Date.now() + offsetMs));

// ---- テスト ----

describe('FormingCandle', () => {
  // ------------------------------------------------------------------
  // open()
  // ------------------------------------------------------------------

  it('open() で最初の tick から足が開かれ、OHLC がすべて bid に初期化される', () => {
    // Given
    const firstTick = tick('150.000');

    // When
    const candle = FormingCandle.open(firstTick, TimeFrame.ONE_MINUTE);

    // Then: open / high / low / close がすべて bid と等しい
    const bid = firstTick.bid();
    expect(candle.openPrice().equals(bid)).toBe(true);
    expect(candle.currentHigh().equals(bid)).toBe(true);
    expect(candle.currentLow().equals(bid)).toBe(true);
    expect(candle.currentClose().equals(bid)).toBe(true);
  });

  it('open() で timeFrame が正しく設定される', () => {
    // Given / When
    const candle = FormingCandle.open(tick('150.000'), TimeFrame.ONE_MINUTE);

    // Then
    expect(candle.timeFrame()).toBe(TimeFrame.ONE_MINUTE);
  });

  it('open() で openTime が firstTick の timestamp から設定される', () => {
    // Given
    const now = new Date();
    const firstTick = tickAt('150.000', now);

    // When
    const candle = FormingCandle.open(firstTick, TimeFrame.ONE_MINUTE);

    // Then: openTime は firstTick の timestamp と一致する
    expect(candle.openTime().equals(CandleOpenTime.of(now))).toBe(true);
  });

  // ------------------------------------------------------------------
  // update() — 高値・安値・終値の更新
  // ------------------------------------------------------------------

  it('update() で高値が更新される（新しい tick の bid が現在の high より高い場合）', () => {
    // Given
    const candle = FormingCandle.open(tick('150.000'), TimeFrame.ONE_MINUTE);
    const highTick = tick('151.000');
    const initialLow = candle.currentLow();

    // When
    candle.update(highTick);

    // Then: high が新しい bid に更新され、low と open は変化しない
    expect(candle.currentHigh().equals(highTick.bid())).toBe(true);
    expect(candle.currentLow().equals(initialLow)).toBe(true);
  });

  it('update() で安値が更新される（新しい tick の bid が現在の low より低い場合）', () => {
    // Given
    const candle = FormingCandle.open(tick('150.000'), TimeFrame.ONE_MINUTE);
    const lowTick = tick('149.000');
    const initialHigh = candle.currentHigh();

    // When
    candle.update(lowTick);

    // Then: low が新しい bid に更新され、high と open は変化しない
    expect(candle.currentLow().equals(lowTick.bid())).toBe(true);
    expect(candle.currentHigh().equals(initialHigh)).toBe(true);
  });

  it('update() で high/low と等しい bid が来ても high/low は変化しない', () => {
    // Given: 高値・安値が確定した足
    const candle = FormingCandle.open(tick('150.000'), TimeFrame.ONE_MINUTE);
    candle.update(tick('151.000')); // high = 151
    candle.update(tick('149.000')); // low = 149
    const highBefore = candle.currentHigh();
    const lowBefore = candle.currentLow();

    // When: ちょうど high / low と等しい tick が来る
    candle.update(tick('151.000')); // high と同値
    candle.update(tick('149.000')); // low と同値

    // Then: high / low は変化しない
    expect(candle.currentHigh().equals(highBefore)).toBe(true);
    expect(candle.currentLow().equals(lowBefore)).toBe(true);
  });

  it('update() で close が常に最新の tick の bid に更新される', () => {
    // Given
    const candle = FormingCandle.open(tick('150.000'), TimeFrame.ONE_MINUTE);
    const firstUpdate = tick('151.000');
    const secondUpdate = tick('149.500');

    // When
    candle.update(firstUpdate);
    candle.update(secondUpdate);

    // Then: close は最後の update の bid になっている
    expect(candle.currentClose().equals(secondUpdate.bid())).toBe(true);
  });

  it('update() は CandleEvent.updated() を返す', () => {
    // Given
    const candle = FormingCandle.open(tick('150.000'), TimeFrame.ONE_MINUTE);

    // When
    const event = candle.update(tick('150.500'));

    // Then
    expect(event.type).toBe('UPDATED');
  });

  // ------------------------------------------------------------------
  // confirm()
  // ------------------------------------------------------------------

  it('confirm() は CandleEvent.confirmed() を返す', () => {
    // Given
    const candle = FormingCandle.open(tick('150.000'), TimeFrame.ONE_MINUTE);

    // When
    const event = candle.confirm(closeTime());

    // Then
    expect(event.type).toBe('CONFIRMED');
  });

  it('確定後に update() を呼ぶとエラーになる', () => {
    // Given: 確定済みの足
    const candle = FormingCandle.open(tick('150.000'), TimeFrame.ONE_MINUTE);
    candle.confirm(closeTime());

    // When / Then
    expect(() => candle.update(tick('151.000'))).toThrow();
  });

  // ------------------------------------------------------------------
  // toConfirmed()
  // ------------------------------------------------------------------

  it('toConfirmed() で ConfirmedCandle に変換され OHLC・timeFrame が正しく引き継がれる', () => {
    // Given: 高値・安値・終値が確定した足
    const openTick = tick('150.000');
    const candle = FormingCandle.open(openTick, TimeFrame.ONE_MINUTE);
    candle.update(tick('151.000')); // high 更新
    candle.update(tick('149.000')); // low 更新
    const lastTick = tick('150.500');
    candle.update(lastTick); // close 更新

    // When
    const confirmed = candle.toConfirmed(closeTime());

    // Then: OHLC が FormingCandle の状態と一致する（bid ベース）
    expect(confirmed.open.equals(openTick.bid())).toBe(true);
    expect(confirmed.high.equals(tick('151.000').bid())).toBe(true);
    expect(confirmed.low.equals(tick('149.000').bid())).toBe(true);
    expect(confirmed.close.equals(lastTick.bid())).toBe(true);
    expect(confirmed.timeFrame).toBe(TimeFrame.ONE_MINUTE);
  });

  it('toConfirmed() が返した ConfirmedCandle は、その後 FormingCandle が更新されても変化しない', () => {
    // Given: toConfirmed() でスナップショットを取得する（confirm() は呼ばない）
    const candle = FormingCandle.open(tick('150.000'), TimeFrame.ONE_MINUTE);
    candle.update(tick('151.000'));
    const confirmed = candle.toConfirmed(closeTime());

    // 確定時の値を保存
    const confirmedClose = confirmed.close;
    const confirmedHigh = confirmed.high;

    // When: その後も FormingCandle を update する
    candle.update(tick('160.000'));
    candle.update(tick('140.000'));

    // Then: confirmed の値は変わっていない（値オブジェクトとして不変）
    expect(confirmed.close.equals(confirmedClose)).toBe(true);
    expect(confirmed.high.equals(confirmedHigh)).toBe(true);
  });
});
