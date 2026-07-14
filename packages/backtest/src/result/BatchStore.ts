import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import type { StrategyType } from '../parameter/StrategyType.js';

/**
 * BT バッチのライフサイクル管理インターフェース。
 *
 * ResultStore（run 単位の保存）とは関心が異なるため分離。
 * JSON モードでは不要なため、Runner には null 許容で注入する。
 */
export interface BatchStore {
  create(batch: BatchInput): Promise<void>;
  complete(batchId: string, status: BatchStatus): Promise<void>;
}

export interface BatchInput {
  readonly batchId: string;
  readonly description: string;
  readonly totalRuns: number;
  readonly strategy: StrategyType;
  readonly pair: CurrencyPair;
  readonly timeframe: TimeFrame;
}

export const BatchStatus = {
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type BatchStatus = (typeof BatchStatus)[keyof typeof BatchStatus];
