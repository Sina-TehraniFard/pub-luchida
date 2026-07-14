import { EntryCommand } from '@luchida/backend/domain/command/EntryCommand.js';
import { ExitCommand } from '@luchida/backend/domain/command/ExitCommand.js';
import { EntryResult } from '@luchida/backend/domain/market/EntryResult.js';
import { ExitResult } from '@luchida/backend/domain/market/ExitResult.js';
import { Price } from '@luchida/backend/domain/market/Price.js';
import { Pips } from '@luchida/backend/domain/market/Pips.js';
import { Timestamp } from '@luchida/backend/domain/market/Timestamp.js';
import { PositionId } from '@luchida/backend/domain/position/PositionId.js';
import { pipUnit } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { BuySell } from '@luchida/backend/domain/market/BuySell.js';
import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { ExecutionSimulator } from './ExecutionSimulator.js';

/**
 * 簡易な約定再現。確定足スキャン（OHLC モード）向け。
 * 渡された executionPrice と executedAt でそのまま約定する。
 */
export class IdealExecutionSimulator implements ExecutionSimulator {
  simulateEntry(
    _command: EntryCommand,
    executionPrice: Price,
    _pair: CurrencyPair,
    executedAt: Timestamp,
  ): EntryResult {
    return EntryResult.of({
      positionId: PositionId.generate(),
      entryPrice: executionPrice,
      executedAt,
    });
  }

  simulateExit(
    _command: ExitCommand,
    executionPrice: Price,
    pair: CurrencyPair,
    entryPrice: Price,
    buySell: BuySell,
    executedAt: Timestamp,
  ): ExitResult {
    const profitLoss = calculatePips(executionPrice, entryPrice, buySell, pair);
    return ExitResult.of({
      exitPrice: executionPrice,
      executedAt,
      profitLoss,
    });
  }
}

function calculatePips(
  exitPrice: Price,
  entryPrice: Price,
  buySell: BuySell,
  pair: CurrencyPair,
): Pips {
  const exit = Number(exitPrice.toString());
  const entry = Number(entryPrice.toString());
  const diff = buySell === 'BUY' ? exit - entry : entry - exit;
  const unit = pipUnit(pair).toNumber();
  return Pips.of((diff / unit).toFixed(4));
}
