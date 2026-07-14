import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExitCompensationQueue } from './ExitCompensationQueue.js';
import { Position } from '../domain/position/Position.js';
import { PositionId } from '../domain/position/PositionId.js';
import { CurrencyPair } from '../domain/market/CurrencyPair.js';
import { BuySell } from '../domain/market/BuySell.js';
import { Lot } from '../domain/position/Lot.js';
import { Price } from '../domain/market/Price.js';
import { Timestamp } from '../domain/market/Timestamp.js';
import { ConvictionScore } from '../domain/market/ConvictionScore.js';
import { Money } from '../domain/Money.js';
import { EntrySnapshot } from '../domain/market/snapshot/EntrySnapshot.js';
import { EntryCommand } from '../domain/command/EntryCommand.js';
import { EntryReason } from '../domain/command/EntryReason.js';
import { EntryResult } from '../domain/market/EntryResult.js';
import { StrategyName } from '../domain/rule/StrategyName.js';
import type { LogPort } from '../domain/port/LogPort.js';
import type { PositionRepository } from '../port/PositionRepository.js';

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

function makePosition(id: PositionId): Position {
  const command = EntryCommand.of({
    pair: CurrencyPair('USD_JPY'),
    buySell: BuySell.BUY,
    lot: Lot.of(100),
    reason: EntryReason.of('test'),
    convictionScore: ConvictionScore.of('0.8'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: EntrySnapshot.of({
      convictionScore: '0.8',
      entryHour: 10,
      entryDayOfWeek: 1,
    }),
    requiredMargin: Money.jpy('600'),
  });
  const result = EntryResult.of({
    positionId: id,
    entryPrice: Price.of('150.000'),
    executedAt: Timestamp.of(new Date('2026-05-15T10:00:00Z')),
  });
  return Position.open(command, result);
}

const mockRepository = (): PositionRepository => ({
  register: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  findById: vi.fn(),
  openPositions: vi.fn(),
  findOpenByPairAndStrategy: vi.fn().mockResolvedValue(null),
  markClosed: vi.fn().mockResolvedValue(undefined),
});

const mockLogger = (): LogPort => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const lastCallEvent = (fn: unknown): string | undefined => {
  const calls = (fn as ReturnType<typeof vi.fn>).mock.calls;
  return (calls.at(-1)?.[1] as { event?: string } | undefined)?.event;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('ExitCompensationQueue', () => {
  describe('enqueue / has / size', () => {
    it('enqueueUpdate で登録され has() が true になる（シールド）', () => {
      const queue = new ExitCompensationQueue(mockRepository(), mockLogger());
      const id = PositionId.from(UUID_A);
      expect(queue.has(id)).toBe(false);
      queue.enqueueUpdate(makePosition(id));
      expect(queue.has(id)).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('同一ポジションの二重登録は無視される', () => {
      const logger = mockLogger();
      const queue = new ExitCompensationQueue(mockRepository(), logger);
      const id = PositionId.from(UUID_A);
      queue.enqueueUpdate(makePosition(id));
      queue.enqueueMarkClosed(id);
      expect(queue.size()).toBe(1);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('登録時に exit_compensation_enqueued を warn で出す', () => {
      const logger = mockLogger();
      const queue = new ExitCompensationQueue(mockRepository(), logger);
      queue.enqueueMarkClosed(PositionId.from(UUID_A));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ event: 'exit_compensation_enqueued', kind: 'markClosed' }),
      );
    });
  });

  describe('drain', () => {
    it('update 成功でキューから外れ exit_compensation_recovered を info で出す', async () => {
      const repo = mockRepository();
      const logger = mockLogger();
      const queue = new ExitCompensationQueue(repo, logger);
      const id = PositionId.from(UUID_A);
      const position = makePosition(id);
      queue.enqueueUpdate(position);

      await queue.drain();

      expect(repo.update).toHaveBeenCalledWith(position);
      expect(queue.has(id)).toBe(false);
      expect(queue.size()).toBe(0);
      expect(lastCallEvent(logger.info)).toBe('exit_compensation_recovered');
    });

    it('markClosed エントリは repository.markClosed でリトライされる', async () => {
      const repo = mockRepository();
      const queue = new ExitCompensationQueue(repo, mockLogger());
      const id = PositionId.from(UUID_A);
      queue.enqueueMarkClosed(id);

      await queue.drain();

      expect(repo.markClosed).toHaveBeenCalledWith(id);
      expect(repo.update).not.toHaveBeenCalled();
      expect(queue.size()).toBe(0);
    });

    it('失敗してもエントリは残り、次の drain で再試行される（打ち切りなし）', async () => {
      const repo = mockRepository();
      (repo.update as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce(undefined);
      const logger = mockLogger();
      const queue = new ExitCompensationQueue(repo, logger);
      const id = PositionId.from(UUID_A);
      queue.enqueueUpdate(makePosition(id));

      await queue.drain();
      expect(queue.has(id)).toBe(true);
      expect(lastCallEvent(logger.warn)).toBe('exit_compensation_retry_failed');

      await queue.drain();
      expect(queue.has(id)).toBe(false);
    });

    it('連続失敗が escalateAfterAttempts に達したら error に昇格する', async () => {
      const repo = mockRepository();
      (repo.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
      const logger = mockLogger();
      const queue = new ExitCompensationQueue(repo, logger, { escalateAfterAttempts: 2 });
      queue.enqueueUpdate(makePosition(PositionId.from(UUID_A)));

      await queue.drain(); // attempts=1 → warn
      expect(logger.error).not.toHaveBeenCalled();
      await queue.drain(); // attempts=2 → error 昇格
      expect(logger.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ event: 'exit_compensation_retry_failed', attempts: 2 }),
      );
    });

    it('1 件の失敗が他エントリのリトライを止めない', async () => {
      const repo = mockRepository();
      (repo.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
      const queue = new ExitCompensationQueue(repo, mockLogger());
      const idA = PositionId.from(UUID_A);
      const idB = PositionId.from(UUID_B);
      queue.enqueueUpdate(makePosition(idA));
      queue.enqueueMarkClosed(idB);

      await queue.drain();

      expect(queue.has(idA)).toBe(true); // update は失敗して残る
      expect(queue.has(idB)).toBe(false); // markClosed は成功して外れる
    });

    it('空キューの drain は repository に触れない', async () => {
      const repo = mockRepository();
      const queue = new ExitCompensationQueue(repo, mockLogger());
      await queue.drain();
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.markClosed).not.toHaveBeenCalled();
    });
  });

  describe('start / stop', () => {
    it('タイマーで drain が周期実行される', async () => {
      vi.useFakeTimers();
      const repo = mockRepository();
      const queue = new ExitCompensationQueue(repo, mockLogger(), { retryIntervalMs: 1000 });
      queue.enqueueUpdate(makePosition(PositionId.from(UUID_A)));

      queue.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(repo.update).toHaveBeenCalledTimes(1);
      expect(queue.size()).toBe(0);
      await queue.stop();
    });

    it('start は冪等（二重起動しない）', async () => {
      vi.useFakeTimers();
      const repo = mockRepository();
      (repo.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
      const queue = new ExitCompensationQueue(repo, mockLogger(), { retryIntervalMs: 1000 });
      queue.enqueueUpdate(makePosition(PositionId.from(UUID_A)));

      queue.start();
      queue.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(repo.update).toHaveBeenCalledTimes(1);
      await queue.stop();
    });

    it('stop 後はタイマーが発火しない', async () => {
      vi.useFakeTimers();
      const repo = mockRepository();
      (repo.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
      const queue = new ExitCompensationQueue(repo, mockLogger(), { retryIntervalMs: 1000 });
      queue.enqueueUpdate(makePosition(PositionId.from(UUID_A)));

      queue.start();
      await queue.stop();
      await vi.advanceTimersByTimeAsync(3000);

      expect(repo.update).not.toHaveBeenCalled();
    });

    it('未収束エントリを残して stop すると warn で引き継ぐ', async () => {
      const logger = mockLogger();
      const queue = new ExitCompensationQueue(mockRepository(), logger);
      queue.enqueueMarkClosed(PositionId.from(UUID_A));

      await queue.stop();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ event: 'exit_compensation_pending_at_shutdown' }),
      );
    });
  });
});
