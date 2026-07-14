import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import type { ConfirmedCandle } from '@luchida/backend/domain/market/candle/ConfirmedCandle.js';
import type { Tick } from '@luchida/backend/domain/market/tick/Tick.js';
import type { DateRange } from '../engine/EngineConfig.js';

/**
 * BT データ取得の抽象化。
 *
 * 確定足と生 tick を別メソッドで提供する。
 * 呼び出し側は実行モードに応じて必要な方だけを使う。
 */
export interface DataProvider {
  /**
   * 確定足を期間指定で取得する。
   *
   * 注意: 戻り値は全件をメモリに載せる配列。1分足 × 1年で約52万本になりうるため、
   * 長期間 × 短時間足の組み合わせでは呼び出し側でチャンク分割を検討すること。
   *
   * @param warmupCount `range.from` より前から追加で取得する本数（インジケーターの初期化に使う）
   */
  fetchCandles(
    pair: CurrencyPair,
    timeframe: TimeFrame,
    range: DateRange,
    warmupCount: number,
  ): Promise<ConfirmedCandle[]>;

  /**
   * 生 tick を期間指定で取得する。
   *
   * 件数が膨大になりうるため AsyncIterable で返す。
   */
  fetchTicks(pair: CurrencyPair, range: DateRange): AsyncIterable<Tick>;
}
