import { describe, it, expect } from 'vitest';

import { Price } from '@luchida/backend/domain/market/Price.js';
import { Tick } from '@luchida/backend/domain/market/tick/Tick.js';
import { TickTimestamp } from '@luchida/backend/domain/market/tick/TickTimestamp.js';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { Timestamp } from '@luchida/backend/domain/market/Timestamp.js';
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
import { Position } from '@luchida/backend/domain/position/Position.js';
import { EntryResult } from '@luchida/backend/domain/market/EntryResult.js';

import { PendingOrderManager } from './PendingOrderManager.js';

const pair = CurrencyPair('USD_JPY');

function makeTick(tsMs: number): Tick {
  const ts = TickTimestamp.of(new Date(tsMs));
  return Tick.of(Price.of('150.050'), Price.of('150.000'), ts);
}

function makeEntryCommand(buySell: 'BUY' | 'SELL' = 'BUY'): EntryCommand {
  return EntryCommand.of({
    pair,
    buySell,
    lot: Lot.of(1000),
    reason: EntryReason.of('テスト'),
    convictionScore: ConvictionScore.of('0.7'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: EntrySnapshot.of({ convictionScore: '0.7', entryHour: 10, entryDayOfWeek: 1 }),
    requiredMargin: Money.jpy('0'),
  });
}

function makeExitCommand(posId: PositionId): ExitCommand {
  return ExitCommand.of({
    positionId: posId,
    type: ExitType.TAKE_PROFIT,
    reason: ExitReason.of('テスト決済'),
  });
}

function makeOpenPosition(buySell: 'BUY' | 'SELL' = 'BUY', tsMs = 1_000_000): Position {
  const command = makeEntryCommand(buySell);
  const result = EntryResult.of({
    positionId: PositionId.generate(),
    entryPrice: Price.of('150.000'),
    executedAt: Timestamp.of(new Date(tsMs)),
  });
  return Position.open(command, result);
}

describe('PendingOrderManager', () => {
  describe('delayMs=0 での即時約定', () => {
    it('同一 tick で accept → check で fill が返る', () => {
      const manager = new PendingOrderManager(0);
      const tick = makeTick(1_000_000);

      manager.acceptEntryOrder(makeEntryCommand(), tick);
      expect(manager.hasPendingEntry()).toBe(true);

      const fill = manager.checkEntryFill(tick);
      expect(fill).not.toBeNull();
      expect(fill!.command.buySell).toBe('BUY');
    });
  });

  describe('delayMs=100 での遅延約定', () => {
    it('tick.ts + 50ms では null、+100ms で fill が返る', () => {
      const manager = new PendingOrderManager(100);
      const acceptTick = makeTick(1_000_000);

      manager.acceptEntryOrder(makeEntryCommand(), acceptTick);

      // 50ms 後: まだ約定しない
      const earlyTick = makeTick(1_000_050);
      expect(manager.checkEntryFill(earlyTick)).toBeNull();

      // 100ms 後: 約定する
      const filledTick = makeTick(1_000_100);
      const fill = manager.checkEntryFill(filledTick);
      expect(fill).not.toBeNull();
    });
  });

  describe('pending 状態の確認', () => {
    it('hasPendingEntry / hasPendingExit / hasAnyPending の状態が正しい', () => {
      const manager = new PendingOrderManager(100);
      const tick = makeTick(1_000_000);

      // 初期状態: pending なし
      expect(manager.hasPendingEntry()).toBe(false);
      expect(manager.hasPendingExit()).toBe(false);
      expect(manager.hasAnyPending()).toBe(false);

      // エントリー受け付け後
      manager.acceptEntryOrder(makeEntryCommand(), tick);
      expect(manager.hasPendingEntry()).toBe(true);
      expect(manager.hasPendingExit()).toBe(false);
      expect(manager.hasAnyPending()).toBe(true);

      // エントリー約定後: pending が消える
      const filledTick = makeTick(1_000_100);
      manager.checkEntryFill(filledTick);
      expect(manager.hasPendingEntry()).toBe(false);
      expect(manager.hasAnyPending()).toBe(false);
    });
  });

  describe('二重 accept の扱い', () => {
    it('pending 中に二重 acceptEntryOrder はエラーをスローする', () => {
      const manager = new PendingOrderManager(100);
      const tick = makeTick(1_000_000);

      manager.acceptEntryOrder(makeEntryCommand(), tick);

      // 2回目の accept はエラー（仕様: pending 中の上書きは禁止）
      expect(() => {
        manager.acceptEntryOrder(makeEntryCommand(), tick);
      }).toThrow();
    });
  });

  describe('settleAtStreamEnd', () => {
    it('保留中エグジットは finalTick 価格で解決（exitFill が返る）', () => {
      const manager = new PendingOrderManager(100);
      const tick = makeTick(1_000_000);
      const position = makeOpenPosition();

      manager.acceptExitOrder(makeExitCommand(position.id), position, tick);
      expect(manager.hasPendingExit()).toBe(true);

      const finalTick = makeTick(1_000_050); // delay 未満だが最終 tick
      const settlement = manager.settleAtStreamEnd(finalTick);

      expect(settlement.exitFill).not.toBeNull();
      expect(manager.hasPendingExit()).toBe(false);
    });

    it('保留中エントリーはキャンセル（戻り値に含まれず hasPendingEntry→false）', () => {
      const manager = new PendingOrderManager(100);
      const tick = makeTick(1_000_000);

      manager.acceptEntryOrder(makeEntryCommand(), tick);
      expect(manager.hasPendingEntry()).toBe(true);

      const finalTick = makeTick(1_000_050);
      const settlement = manager.settleAtStreamEnd(finalTick);

      // エントリーはキャンセルされ、戻り値には exitFill のみ
      expect(settlement.exitFill).toBeNull();
      expect(manager.hasPendingEntry()).toBe(false);
    });
  });
});
