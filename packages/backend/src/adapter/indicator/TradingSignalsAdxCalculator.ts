import { ADX } from 'trading-signals';
import Big from 'big.js';
import { ConfirmedCandle } from '../../domain/market/candle/ConfirmedCandle.js';
import { AdxCalculator } from '../../domain/market/indicator/AdxCalculator.js';
import { AdxPeriod } from '../../domain/market/indicator/AdxPeriod.js';
import { AdxValue } from '../../domain/market/indicator/AdxValue.js';
import { DiPlus, DiMinus } from '../../domain/market/indicator/DiValue.js';
import { TrendStrength } from '../../domain/market/indicator/TrendStrength.js';

/**
 * trading-signals の ADX を使った AdxCalculator 実装。
 *
 * trading-signals の ADX は本体（ADX）を 0–100 で、+DI/−DI（pdi/mdi）を 0–1 の
 * 比率で返す。ドメインの DI 値オブジェクトは 0–100 で表すため、DI は 100 倍して渡す。
 */
export class TradingSignalsAdxCalculator implements AdxCalculator {
  private static readonly DI_SCALE = new Big(100);

  calculate(
    candles: readonly ConfirmedCandle[],
    period: AdxPeriod,
  ): TrendStrength | null {
    const adx = new ADX(period.toNumber());

    for (const candle of candles) {
      adx.update(
        {
          high: Number(candle.high.toString()),
          low: Number(candle.low.toString()),
          close: Number(candle.close.toString()),
        },
        false,
      );
    }

    const pdi = adx.pdi;
    const mdi = adx.mdi;
    if (!adx.isStable || pdi === undefined || mdi === undefined) {
      return null;
    }

    return TrendStrength.of({
      adx: AdxValue.of(new Big(adx.getResultOrThrow()).toFixed()),
      diPlus: DiPlus.of(this.toDiScale(pdi)),
      diMinus: DiMinus.of(this.toDiScale(mdi)),
    });
  }

  /** trading-signals の 0–1 比率 DI を 0–100 スケールの文字列に変換する。 */
  private toDiScale(ratio: number): string {
    return new Big(ratio).times(TradingSignalsAdxCalculator.DI_SCALE).toFixed();
  }
}
