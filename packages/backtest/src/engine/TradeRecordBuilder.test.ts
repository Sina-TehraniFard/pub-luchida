import { describe, it, expect } from 'vitest';

import { Price } from '@luchida/backend/domain/market/Price.js';
import { Pips } from '@luchida/backend/domain/market/Pips.js';
import { Timestamp } from '@luchida/backend/domain/market/Timestamp.js';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { EntryCommand } from '@luchida/backend/domain/command/EntryCommand.js';
import { ExitCommand, ExitType } from '@luchida/backend/domain/command/ExitCommand.js';
import { EntryReason } from '@luchida/backend/domain/command/EntryReason.js';
import { ExitReason } from '@luchida/backend/domain/command/ExitReason.js';
import { ConvictionScore } from '@luchida/backend/domain/market/ConvictionScore.js';
import { EntrySnapshot } from '@luchida/backend/domain/market/snapshot/EntrySnapshot.js';
import { Money } from '@luchida/backend/domain/Money.js';
import { Lot } from '@luchida/backend/domain/position/Lot.js';
import { PositionId } from '@luchida/backend/domain/position/PositionId.js';
import { StrategyName } from '@luchida/backend/domain/rule/StrategyName.js';
import { Position } from '@luchida/backend/domain/position/Position.js';
import { EntryResult } from '@luchida/backend/domain/market/EntryResult.js';
import { ExitResult } from '@luchida/backend/domain/market/ExitResult.js';

import { buildTradeRecord } from './TradeRecordBuilder.js';

const pair = CurrencyPair('USD_JPY');

function makeClosedPosition(params: {
  buySell: 'BUY' | 'SELL';
  entryPrice: string;
  exitPrice: string;
  entryTimeMs: number;
  exitTimeMs: number;
  exitType: ExitType;
  pnlPips: string;
}): Position {
  const entryCommand = EntryCommand.of({
    pair,
    buySell: params.buySell,
    lot: Lot.of(1000),
    reason: EntryReason.of('テスト'),
    convictionScore: ConvictionScore.of('0.7'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: EntrySnapshot.of({ convictionScore: '0.7', entryHour: 10, entryDayOfWeek: 1 }),
    requiredMargin: Money.jpy('0'),
  });

  const entryResult = EntryResult.of({
    positionId: PositionId.generate(),
    entryPrice: Price.of(params.entryPrice),
    executedAt: Timestamp.of(new Date(params.entryTimeMs)),
  });

  const position = Position.open(entryCommand, entryResult);

  const exitCommand = ExitCommand.of({
    positionId: position.id,
    type: params.exitType,
    reason: ExitReason.of('テスト決済'),
  });

  const exitResult = ExitResult.of({
    exitPrice: Price.of(params.exitPrice),
    executedAt: Timestamp.of(new Date(params.exitTimeMs)),
    profitLoss: Pips.of(params.pnlPips),
  });

  position.close(exitCommand, exitResult);
  return position;
}

describe('buildTradeRecord', () => {
  it('決済済みポジションから正しい TradeRecord を生成する', () => {
    const entryTimeMs = new Date('2024-01-01T10:00:00Z').getTime();
    const exitTimeMs = new Date('2024-01-01T11:30:00Z').getTime();

    const position = makeClosedPosition({
      buySell: 'BUY',
      entryPrice: '150.000',
      exitPrice: '150.200',
      entryTimeMs,
      exitTimeMs,
      exitType: ExitType.TAKE_PROFIT,
      pnlPips: '20',
    });

    const record = buildTradeRecord({
      position,
      runId: 'test-run-001',
      tradeSeq: 0,
      extremes: null,
      capitalAtEntry: 100_000,
      slippagePips: 0,
      equityAfter: 100_000,
      pair,
      atrAtEntry: null,
    });

    expect(record.runId).toBe('test-run-001');
    expect(record.side).toBe('BUY');
    expect(record.entryPrice).toBeCloseTo(150.0, 3);
    expect(record.exitPrice).toBeCloseTo(150.2, 3);
    expect(record.pnlPips).toBeCloseTo(20, 4);
    expect(record.exitType).toBe('TAKE_PROFIT');
    expect(record.entryHourUtc).toBe(10);
    expect(record.entryDayOfWeek).toBe(1); // Monday
  });

  it('holdingPeriodMs が正しく計算される', () => {
    const entryTimeMs = new Date('2024-01-01T09:00:00Z').getTime();
    const exitTimeMs = new Date('2024-01-01T09:45:00Z').getTime();
    const expectedHoldingMs = exitTimeMs - entryTimeMs; // 45分 = 2_700_000ms

    const position = makeClosedPosition({
      buySell: 'SELL',
      entryPrice: '150.200',
      exitPrice: '150.000',
      entryTimeMs,
      exitTimeMs,
      exitType: ExitType.TAKE_PROFIT,
      pnlPips: '20',
    });

    const record = buildTradeRecord({
      position,
      runId: 'test-run-002',
      tradeSeq: 0,
      extremes: null,
      capitalAtEntry: 100_000,
      slippagePips: 0,
      equityAfter: 100_000,
      pair,
      atrAtEntry: null,
    });

    expect(record.holdingPeriodMs).toBe(expectedHoldingMs);
    expect(record.holdingPeriodMs).toBe(2_700_000);
  });
});
