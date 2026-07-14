import { EntryResult } from '@luchida/backend/domain/market/EntryResult.js';
import { ExitResult } from '@luchida/backend/domain/market/ExitResult.js';
import { Pips } from '@luchida/backend/domain/market/Pips.js';
import { Timestamp } from '@luchida/backend/domain/market/Timestamp.js';
import { PositionId } from '@luchida/backend/domain/position/PositionId.js';
import { pipUnit } from '@luchida/backend/domain/market/CurrencyPair.js';
import { opposite } from '@luchida/backend/domain/market/BuySell.js';
import type { EntryCommand } from '@luchida/backend/domain/command/EntryCommand.js';
import type { ExitCommand } from '@luchida/backend/domain/command/ExitCommand.js';
import type { Price } from '@luchida/backend/domain/market/Price.js';
import type { BuySell } from '@luchida/backend/domain/market/BuySell.js';
import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { ExecutionSimulator } from './ExecutionSimulator.js';
import type { SlippageModel } from './SlippageModel.js';

/**
 * 現実の約定を再現する ExecutionSimulator 実装。
 * スリッページを SlippageModel 経由で加算する。
 *
 * - エントリー: エントリー方向に滑る（BUY → 価格上昇、SELL → 価格下落）
 * - 決済: エグジット方向（エントリーと逆）に滑る
 */
export class RealisticExecutionSimulator implements ExecutionSimulator {
  constructor(private readonly slippage: SlippageModel) {}

  simulateEntry(
    _command: EntryCommand,
    executionPrice: Price,
    pair: CurrencyPair,
    executedAt: Timestamp,
  ): EntryResult {
    const slippedPrice = this.slippage.applyTo(executionPrice, _command.buySell);
    return EntryResult.of({
      positionId: PositionId.generate(),
      entryPrice: slippedPrice,
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
    // 決済時はエントリーの逆方向に滑る
    const exitSide = opposite(buySell);
    const slippedPrice = this.slippage.applyTo(executionPrice, exitSide);
    const profitLoss = calculatePips(slippedPrice, entryPrice, buySell, pair);
    return ExitResult.of({
      exitPrice: slippedPrice,
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
