import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';

/**
 * Engine が動くために必要な最小の実行条件。
 *
 * 戦略パラメータは含まない（Rule 側で注入済み）。
 */
export interface EngineConfig {
  readonly pair: CurrencyPair;
  readonly timeframe: TimeFrame;
  readonly dateRange: DateRange;
  /**
   * インジケーター warmup に必要な確定足の本数。
   * warmup 完了前は Rule を呼ばず、トレードも記録しない。
   */
  readonly warmupCount: number;
}

export const EngineMode = {
  /** 確定足ベースのスキャン */
  OHLC: 'OHLC',
  /** 生 tick ベースの精密検証 */
  TICK: 'TICK',
} as const;
export type EngineMode = (typeof EngineMode)[keyof typeof EngineMode];

/**
 * 検証対象の期間。
 * `from` は inclusive、`to` は exclusive として扱う（半開区間）。
 */
export interface DateRange {
  readonly from: Date;
  readonly to: Date;
}
