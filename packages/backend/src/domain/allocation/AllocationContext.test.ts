import { describe, it, expect } from 'vitest';
import { AllocationContext } from './AllocationContext.js';
import { DetectedSignals } from '../rule/DetectedSignals.js';
import { OpenPositions } from '../position/OpenPositions.js';
import { Balance } from '../Balance.js';
import { Money } from '../Money.js';
import { StrategyName } from '../rule/StrategyName.js';
import { CurrencyPair } from '../market/CurrencyPair.js';
import { Position } from '../position/Position.js';
import { PositionId } from '../position/PositionId.js';
import { EntryCommand } from '../command/EntryCommand.js';
import { EntryResult } from '../market/EntryResult.js';
import { EntryReason } from '../command/EntryReason.js';
import { BuySell } from '../market/BuySell.js';
import { Lot } from '../position/Lot.js';
import { Price } from '../market/Price.js';
import { Timestamp } from '../market/Timestamp.js';
import { ConvictionScore } from '../market/ConvictionScore.js';
import { EntrySnapshot } from '../market/snapshot/EntrySnapshot.js';

const DUMMY_SNAPSHOT = EntrySnapshot.of({
  convictionScore: '0.5',
  entryHour: 12,
  entryDayOfWeek: 3,
});

const PAIR_USD = CurrencyPair('USD_JPY');

const makePosition = (strategy: StrategyName = StrategyName.SMA_CROSS): Position => {
  const command = EntryCommand.of({
    pair: PAIR_USD,
    buySell: BuySell.BUY,
    lot: Lot.of(100),
    reason: EntryReason.of('test'),
    convictionScore: ConvictionScore.of('0.8'),
    strategyName: strategy,
    entrySnapshot: DUMMY_SNAPSHOT,
    requiredMargin: Money.jpy('600'),
  });
  const result = EntryResult.of({
    positionId: PositionId.generate(),
    entryPrice: Price.of('150.500'),
    executedAt: Timestamp.of(new Date('2024-01-15T10:00:00Z')),
  });
  return Position.open(command, result);
};

describe('AllocationContext', () => {
  describe('of()', () => {
    it('全フィールドを保持し各ゲッターで参照を返す', () => {
      // Given
      const pair = PAIR_USD;
      const ds = DetectedSignals.of([StrategyName.SMA_CROSS]);
      const op = OpenPositions.empty();
      const balance = Balance.of(Money.jpy('1000000'));

      // When
      const ctx = AllocationContext.of(pair, ds, op, balance);

      // Then
      expect(ctx.pair()).toBe(pair);
      expect(ctx.detectedSignals()).toBe(ds);
      expect(ctx.currentPositions()).toBe(op);
      expect(ctx.balance()).toBe(balance);
    });

    it('balance の通貨が pair の quote と不一致なら throw', () => {
      // Given: USD_JPY なのに USD 建ての balance（不変条件違反）
      const pair = PAIR_USD;
      const ds = DetectedSignals.empty();
      const op = OpenPositions.empty();
      const balance = Balance.of(Money.of('100', 'USD'));

      // When / Then
      expect(() => AllocationContext.of(pair, ds, op, balance)).toThrow(/通貨.*一致しません/);
    });
  });

  describe('equals()', () => {
    it('全フィールドが等価なら true（別インスタンスでも値比較で通る）', () => {
      // Given: DetectedSignals / OpenPositions / Balance はすべて別インスタンスで等価
      const pair = PAIR_USD;
      const ds1 = DetectedSignals.of([StrategyName.SMA_CROSS]);
      const ds2 = DetectedSignals.of([StrategyName.SMA_CROSS]);
      const op1 = OpenPositions.empty();
      const op2 = OpenPositions.empty();
      const balance1 = Balance.of(Money.jpy('1000000'));
      const balance2 = Balance.of(Money.jpy('1000000'));

      // When
      const a = AllocationContext.of(pair, ds1, op1, balance1);
      const b = AllocationContext.of(pair, ds2, op2, balance2);

      // Then: 参照同一性ではなく値比較で等価判定する
      expect(a.equals(b)).toBe(true);
    });

    it('pair が違えば false', () => {
      // Given
      const ds = DetectedSignals.empty();
      const op = OpenPositions.empty();
      const balance = Balance.of(Money.jpy('1000000'));

      // When
      const a = AllocationContext.of(CurrencyPair('USD_JPY'), ds, op, balance);
      const b = AllocationContext.of(CurrencyPair('EUR_JPY'), ds, op, balance);

      // Then
      expect(a.equals(b)).toBe(false);
    });

    it('balance が違えば false', () => {
      // Given
      const pair = PAIR_USD;
      const ds = DetectedSignals.empty();
      const op = OpenPositions.empty();

      // When
      const a = AllocationContext.of(pair, ds, op, Balance.of(Money.jpy('1000000')));
      const b = AllocationContext.of(pair, ds, op, Balance.of(Money.jpy('500000')));

      // Then
      expect(a.equals(b)).toBe(false);
    });

    it('detectedSignals が違えば false', () => {
      // Given
      const pair = PAIR_USD;
      const op = OpenPositions.empty();
      const balance = Balance.of(Money.jpy('1000000'));

      // When
      const a = AllocationContext.of(
        pair,
        DetectedSignals.of([StrategyName.SMA_CROSS]),
        op,
        balance,
      );
      const b = AllocationContext.of(
        pair,
        DetectedSignals.of([StrategyName.RSI_REVERSAL]),
        op,
        balance,
      );

      // Then
      expect(a.equals(b)).toBe(false);
    });

    it('currentPositions が違えば false', () => {
      // Given
      const pair = PAIR_USD;
      const ds = DetectedSignals.empty();
      const balance = Balance.of(Money.jpy('1000000'));

      // When
      const a = AllocationContext.of(pair, ds, OpenPositions.empty(), balance);
      const b = AllocationContext.of(pair, ds, OpenPositions.of([makePosition()]), balance);

      // Then
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('pair・detected・positions（件数）・balance を含む文字列を返す', () => {
      // Given
      const pair = PAIR_USD;
      const ds = DetectedSignals.of([StrategyName.SMA_CROSS]);
      const op = OpenPositions.of([makePosition()]);
      const balance = Balance.of(Money.jpy('1000000'));

      // When
      const ctx = AllocationContext.of(pair, ds, op, balance);
      const s = ctx.toString();

      // Then
      expect(s).toContain('USD_JPY');
      expect(s).toContain('SMA_CROSS');
      expect(s).toContain('n=1');
      expect(s).toContain('1000000');
    });
  });
});
