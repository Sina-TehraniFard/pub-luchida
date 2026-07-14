import { describe, it, expect } from 'vitest';
import { TradingSignalsAdxCalculator } from './TradingSignalsAdxCalculator.js';
import { ConfirmedCandle } from '../../domain/market/candle/ConfirmedCandle.js';
import { Price } from '../../domain/market/Price.js';
import { CandleOpenTime } from '../../domain/market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '../../domain/market/candle/CandleCloseTime.js';
import { TimeFrame, durationMs } from '../../domain/market/TimeFrame.js';
import { AdxPeriod } from '../../domain/market/indicator/AdxPeriod.js';
import { TrendDirection } from '../../domain/market/indicator/TrendDirection.js';

const TF = TimeFrame.ONE_HOUR;
const BASE_OPEN = new Date('2026-03-01T00:00:00.000Z').getTime();

/** OHLC（数値）から ConfirmedCandle を作る。openTime は index で 1 時間刻み。 */
function candle(index: number, ohlc: { o: string; h: string; l: string; c: string }): ConfirmedCandle {
  const openMs = BASE_OPEN + index * durationMs(TF);
  return ConfirmedCandle.of({
    open: Price.of(ohlc.o),
    high: Price.of(ohlc.h),
    low: Price.of(ohlc.l),
    close: Price.of(ohlc.c),
    openTime: CandleOpenTime.of(new Date(openMs)),
    closeTime: CandleCloseTime.of(new Date(openMs + durationMs(TF) - 1)),
    timeFrame: TF,
  });
}

describe('TradingSignalsAdxCalculator', () => {
  const calculator = new TradingSignalsAdxCalculator();
  const period = AdxPeriod.of(14);

  it('データ不足（安定しない本数）では null を返す', () => {
    // ADX(14) は安定までに十分な本数を要する。5本では確定しない。
    const few = Array.from({ length: 5 }, (_, i) =>
      candle(i, { o: '100', h: '101', l: '99', c: '100.5' }),
    );
    expect(calculator.calculate(few, period)).toBeNull();
  });

  it('純粋な上昇トレンド（毎足 high/low/close が前足を完全に上回る）では −DI=0・ADX=100・方向 UP', () => {
    // Given: 下落が一切ない単調上昇。各足は前足の high より低い low を持たない。
    //   → 各足の -DM = 0、+DM > 0。よって Wilder 定義上 -DI は常に 0。
    //   → DX = 100*|+DI - -DI|/(+DI + -DI) = 100*(+DI)/(+DI) = 100。
    //   → ADX（DX の平滑）も 100 に収束する。
    //   これらはライブラリではなく Wilder の定義から手で導ける期待値。
    const bars: ConfirmedCandle[] = [];
    let level = 100;
    for (let i = 0; i < 60; i++) {
      const low = level;
      const high = level + 2;
      const close = level + 1.5;
      bars.push(
        candle(i, {
          o: String(level + 0.5),
          h: String(high),
          l: String(low),
          c: String(close),
        }),
      );
      level += 2; // 次足の low(level) は前足の high(level+2 の前値) より上 → -DM=0
    }

    // When
    const result = calculator.calculate(bars, period);

    // Then
    expect(result).not.toBeNull();
    expect(result!.diMinus.toFixed(1)).toBe('0.0');
    expect(result!.adx.toFixed(1)).toBe('100.0');
    expect(result!.direction()).toBe(TrendDirection.UP);
    // +DI は下降がないため正の値を持つ
    expect(Number(result!.diPlus.toString())).toBeGreaterThan(0);
  });

  it('純粋な下降トレンドでは +DI=0・方向 DOWN', () => {
    const bars: ConfirmedCandle[] = [];
    let level = 200;
    for (let i = 0; i < 60; i++) {
      const high = level;
      const low = level - 2;
      const close = level - 1.5;
      bars.push(
        candle(i, {
          o: String(level - 0.5),
          h: String(high),
          l: String(low),
          c: String(close),
        }),
      );
      level -= 2;
    }

    const result = calculator.calculate(bars, period);

    expect(result).not.toBeNull();
    expect(result!.diPlus.toFixed(1)).toBe('0.0');
    expect(result!.adx.toFixed(1)).toBe('100.0');
    expect(result!.direction()).toBe(TrendDirection.DOWN);
  });
});
