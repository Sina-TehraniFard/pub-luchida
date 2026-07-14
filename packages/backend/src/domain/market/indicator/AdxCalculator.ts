import { ConfirmedCandle } from '../candle/ConfirmedCandle.js';
import { AdxPeriod } from './AdxPeriod.js';
import { TrendStrength } from './TrendStrength.js';

/**
 * ADX / +DI / −DI 計算の Port。
 *
 * ドメイン層は ADX の計算方法（trading-signals 等）を知らない。具体的な実装は
 * Adapter 層に置く（SmaCalculator と同じ方針）。
 */
export interface AdxCalculator {
  /**
   * 確定足の列から最新の ADX / +DI / −DI を計算する。
   *
   * @param candles 古い順に並んだ確定足。少なくとも安定に必要な本数が要る。
   * @param period  ADX/DI 期間。
   * @returns 計算できれば TrendStrength、本数不足等で安定しなければ null。
   */
  calculate(candles: readonly ConfirmedCandle[], period: AdxPeriod): TrendStrength | null;
}
