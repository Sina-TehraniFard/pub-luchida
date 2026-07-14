import type { EntryCommand } from '@luchida/backend/domain/command/EntryCommand.js';
import type { ExitCommand } from '@luchida/backend/domain/command/ExitCommand.js';
import type { EntryResult } from '@luchida/backend/domain/market/EntryResult.js';
import type { ExitResult } from '@luchida/backend/domain/market/ExitResult.js';
import type { Price } from '@luchida/backend/domain/market/Price.js';
import type { BuySell } from '@luchida/backend/domain/market/BuySell.js';
import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { Timestamp } from '@luchida/backend/domain/market/Timestamp.js';

/**
 * 約定再現のインターフェース。
 *
 * 本番環境では外部ブローカーが担う約定処理を、BT 内で再現する。
 * 精度や再現度の異なる複数の実装を差し替えられる。
 */
export interface ExecutionSimulator {
  simulateEntry(
    command: EntryCommand,
    executionPrice: Price,
    pair: CurrencyPair,
    executedAt: Timestamp,
  ): EntryResult;

  simulateExit(
    command: ExitCommand,
    executionPrice: Price,
    pair: CurrencyPair,
    entryPrice: Price,
    buySell: BuySell,
    executedAt: Timestamp,
  ): ExitResult;
}
