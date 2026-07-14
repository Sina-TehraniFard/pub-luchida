import { describe, it, expect } from 'vitest';

import { Price } from '@luchida/backend/domain/market/Price.js';
import { Timestamp } from '@luchida/backend/domain/market/Timestamp.js';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { EntryCommand } from '@luchida/backend/domain/command/EntryCommand.js';
import { ExitCommand, ExitType } from '@luchida/backend/domain/command/ExitCommand.js';
import { EntryReason } from '@luchida/backend/domain/command/EntryReason.js';
import { ExitReason } from '@luchida/backend/domain/command/ExitReason.js';
import { ConvictionScore } from '@luchida/backend/domain/market/ConvictionScore.js';
import { EntrySnapshot } from '@luchida/backend/domain/market/snapshot/EntrySnapshot.js';
import { Lot } from '@luchida/backend/domain/position/Lot.js';
import { Money } from '@luchida/backend/domain/Money.js';
import { PositionId } from '@luchida/backend/domain/position/PositionId.js';
import { StrategyName } from '@luchida/backend/domain/rule/StrategyName.js';

import { IdealExecutionSimulator } from './IdealExecutionSimulator.js';

const jpyPair = CurrencyPair('USD_JPY');
const eurPair = CurrencyPair('EUR_USD');

function makeEntryCommand(buySell: 'BUY' | 'SELL'): EntryCommand {
  return EntryCommand.of({
    pair: jpyPair,
    buySell,
    lot: Lot.of(1000),
    reason: EntryReason.of('テスト'),
    convictionScore: ConvictionScore.of('0.7'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: EntrySnapshot.of({ convictionScore: '0.7', entryHour: 10, entryDayOfWeek: 1 }),
    requiredMargin: Money.jpy('0'),
  });
}

function makeExitCommand(): ExitCommand {
  return ExitCommand.of({
    positionId: PositionId.from('test-pos'),
    type: ExitType.TAKE_PROFIT,
    reason: ExitReason.of('テスト決済'),
  });
}

describe('IdealExecutionSimulator', () => {
  const sim = new IdealExecutionSimulator();

  describe('simulateEntry', () => {
    it('約定価格が executionPrice と一致する', () => {
      const result = sim.simulateEntry(makeEntryCommand('BUY'), Price.of('150.100'), jpyPair, Timestamp.of(new Date('2024-01-01T00:00:00Z')));
      expect(result.entryPrice.toString()).toBe('150.1');
    });

    it('PositionId が UUID 形式で採番される', () => {
      const result = sim.simulateEntry(makeEntryCommand('BUY'), Price.of('150.100'), jpyPair, Timestamp.of(new Date('2024-01-01T00:00:00Z')));
      expect(result.positionId.toString()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe('simulateExit', () => {
    it('BUY 決済の損益が正しく計算される（利益）', () => {
      // entry=150.100, exit=150.200 → (150.200-150.100)/0.01 = 10.0 pips
      const result = sim.simulateExit(
        makeExitCommand(),
        Price.of('150.200'),
        jpyPair,
        Price.of('150.100'),
        'BUY',
        Timestamp.of(new Date('2024-01-01T01:00:00Z')),
      );
      expect(result.exitPrice.toString()).toBe('150.2');
      expect(Number(result.profitLoss.toString())).toBeCloseTo(10.0, 2);
    });

    it('SELL 決済の損益が正しく計算される（利益）', () => {
      // entry=150.200, exit=150.100 → (150.200-150.100)/0.01 = 10.0 pips
      const result = sim.simulateExit(
        makeExitCommand(),
        Price.of('150.100'),
        jpyPair,
        Price.of('150.200'),
        'SELL',
        Timestamp.of(new Date('2024-01-01T01:00:00Z')),
      );
      expect(result.exitPrice.toString()).toBe('150.1');
      expect(Number(result.profitLoss.toString())).toBeCloseTo(10.0, 2);
    });

    it('非 JPY ペア（EUR_USD）で pip unit 0.0001 が適用される', () => {
      // entry=1.10000, exit=1.10100 → (1.10100-1.10000)/0.0001 = 10.0 pips
      const result = sim.simulateExit(
        makeExitCommand(),
        Price.of('1.10100'),
        eurPair,
        Price.of('1.10000'),
        'BUY',
        Timestamp.of(new Date('2024-01-01T01:00:00Z')),
      );
      expect(Number(result.profitLoss.toString())).toBeCloseTo(10.0, 2);
    });

    it('損切り（マイナス pips）の場合も正しく計算される', () => {
      // BUY entry=150.200, exit=150.100 → (150.100-150.200)/0.01 = -10.0 pips
      const result = sim.simulateExit(
        makeExitCommand(),
        Price.of('150.100'),
        jpyPair,
        Price.of('150.200'),
        'BUY',
        Timestamp.of(new Date('2024-01-01T01:00:00Z')),
      );
      expect(Number(result.profitLoss.toString())).toBeCloseTo(-10.0, 2);
      expect(result.profitLoss.isNegative()).toBe(true);
    });
  });
});
