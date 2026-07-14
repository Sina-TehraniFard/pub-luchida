import { describe, it, expect, vi } from 'vitest';
import { PositionExtremesUpdater } from './PositionExtremesUpdater.js';
import { ExtremeTracker } from '../domain/position/ExtremeTracker.js';
import { OpenPositions } from '../domain/position/OpenPositions.js';
import { Position } from '../domain/position/Position.js';
import { PositionId } from '../domain/position/PositionId.js';
import { CurrencyPair } from '../domain/market/CurrencyPair.js';
import { BuySell } from '../domain/market/BuySell.js';
import { Lot } from '../domain/position/Lot.js';
import { Price } from '../domain/market/Price.js';
import { Timestamp } from '../domain/market/Timestamp.js';
import { Tick } from '../domain/market/tick/Tick.js';
import { TickTimestamp } from '../domain/market/tick/TickTimestamp.js';
import { ConvictionScore } from '../domain/market/ConvictionScore.js';
import { Money } from '../domain/Money.js';
import { StrategyName } from '../domain/rule/StrategyName.js';
import { EntrySnapshot } from '../domain/market/snapshot/EntrySnapshot.js';
import { EntryCommand } from '../domain/command/EntryCommand.js';
import { EntryReason } from '../domain/command/EntryReason.js';
import { EntryResult } from '../domain/market/EntryResult.js';
import { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';
import { TimeFrame, LIVE_TIMEFRAMES } from '../domain/market/TimeFrame.js';
import { TimeFrameSnapshot } from '../domain/market/snapshot/TimeFrameSnapshot.js';
import type { PositionRepository } from '../port/PositionRepository.js';

const USD_JPY = CurrencyPair('USD_JPY');
const EUR_JPY = CurrencyPair('EUR_JPY');
const T0 = new Date('2026-05-15T10:00:00Z');
const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

const DUMMY_ENTRY_SNAPSHOT = EntrySnapshot.of({
  convictionScore: '0.8',
  entryHour: 10,
  entryDayOfWeek: 1,
});

function makePosition(
  id: PositionId,
  pair: CurrencyPair,
  buySell: BuySell = BuySell.BUY,
): Position {
  const command = EntryCommand.of({
    pair,
    buySell,
    lot: Lot.of(100),
    reason: EntryReason.of('test'),
    convictionScore: ConvictionScore.of('0.8'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: DUMMY_ENTRY_SNAPSHOT,
    requiredMargin: Money.jpy('600'),
  });
  const result = EntryResult.of({
    positionId: id,
    entryPrice: Price.of('150.000'),
    executedAt: Timestamp.of(T0),
  });
  return Position.open(command, result);
}

function makeSnapshot(bid: string, ask: string, pair: CurrencyPair = USD_JPY): MarketSnapshot {
  const tick = Tick.of(Price.of(ask), Price.of(bid), TickTimestamp.of(T0));
  const timeFrames = new Map<TimeFrame, TimeFrameSnapshot>();
  for (const tf of LIVE_TIMEFRAMES) {
    timeFrames.set(tf, {} as unknown as TimeFrameSnapshot);
  }
  return MarketSnapshot.of({
    timeFrames,
    tick,
    pair,
    capturedAt: Timestamp.of(T0),
  });
}

const mockPositionRepository = (
  positions: OpenPositions = OpenPositions.empty(),
): PositionRepository => ({
  register: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  findById: vi.fn(),
  openPositions: vi.fn().mockResolvedValue(positions),
  findOpenByPairAndStrategy: vi.fn().mockResolvedValue(null),
  markClosed: vi.fn().mockResolvedValue(undefined),
});

describe('PositionExtremesUpdater', () => {
  describe('update()', () => {
    it('初回 update で内部に Position が登録され find で取得できる', async () => {
      // Given: USD_JPY ポジション 1 件を持つ Repository
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA, USD_JPY)]);
      const repo = mockPositionRepository(positions);
      const tracker = new ExtremeTracker();
      const updater = new PositionExtremesUpdater(repo, tracker);

      // When: update を呼ぶ
      await updater.update(USD_JPY, makeSnapshot('149.500', '149.505'));

      // Then: find で ExtremesSnapshot が取得できる
      const snapshot = updater.find(idA);
      expect(snapshot).toBeDefined();
      expect(snapshot?.highest.equals(Price.of('149.500'))).toBe(true);
    });

    it('pair-bound: 引数 pair 以外の Position は update 対象に入らない', async () => {
      // Given: USD_JPY と EUR_JPY のポジション
      const idUsd = PositionId.from(UUID_A);
      const idEur = PositionId.from(UUID_B);
      const positions = OpenPositions.of([
        makePosition(idUsd, USD_JPY),
        makePosition(idEur, EUR_JPY),
      ]);
      const repo = mockPositionRepository(positions);
      const updater = new PositionExtremesUpdater(repo);

      // When: USD_JPY で update
      await updater.update(USD_JPY, makeSnapshot('149.500', '149.505'));

      // Then: USD_JPY は追跡開始、EUR_JPY は未追跡
      expect(updater.find(idUsd)).toBeDefined();
      expect(updater.find(idEur)).toBeUndefined();
    });

    it('複数回 update すると BUY の highest/lowest が累積更新される', async () => {
      // Given: BUY ポジション 1 件
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA, USD_JPY, BuySell.BUY)]);
      const repo = mockPositionRepository(positions);
      const updater = new PositionExtremesUpdater(repo);

      // When: 3 回 update（bid が 149.500 → 150.000 → 149.000 で推移）
      await updater.update(USD_JPY, makeSnapshot('149.500', '149.505'));
      await updater.update(USD_JPY, makeSnapshot('150.000', '150.005'));
      await updater.update(USD_JPY, makeSnapshot('149.000', '149.005'));

      // Then: highest=150.000, lowest=149.000
      const snapshot = updater.find(idA);
      expect(snapshot?.highest.equals(Price.of('150.000'))).toBe(true);
      expect(snapshot?.lowest.equals(Price.of('149.000'))).toBe(true);
    });

    it('複数回 update すると SELL の highest/lowest が ask で累積更新される', async () => {
      // Given: SELL ポジション 1 件（ExtremeTracker は SELL なら ask 側で追跡）
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA, USD_JPY, BuySell.SELL)]);
      const repo = mockPositionRepository(positions);
      const updater = new PositionExtremesUpdater(repo);

      // When: 3 回 update（ask が 149.505 → 150.005 → 149.005 で推移）
      await updater.update(USD_JPY, makeSnapshot('149.500', '149.505'));
      await updater.update(USD_JPY, makeSnapshot('150.000', '150.005'));
      await updater.update(USD_JPY, makeSnapshot('149.000', '149.005'));

      // Then: highest=150.005, lowest=149.005（ask 側で追跡）
      const snapshot = updater.find(idA);
      expect(snapshot?.highest.equals(Price.of('150.005'))).toBe(true);
      expect(snapshot?.lowest.equals(Price.of('149.005'))).toBe(true);
    });

    it('pair と snapshot.pair が不一致なら throw（fail-fast）', async () => {
      // Given: 何も保有していない Repository
      const repo = mockPositionRepository();
      const updater = new PositionExtremesUpdater(repo);

      // When / Then: USD_JPY 引数だが snapshot は EUR_JPY → throw
      await expect(
        updater.update(USD_JPY, makeSnapshot('149.500', '149.505', EUR_JPY)),
      ).rejects.toThrow(/pair と snapshot.pair が不一致/);
    });
  });

  describe('find()', () => {
    it('一度も update されていない Position に対しては undefined を返す', () => {
      // Given: update を実行していない Updater
      const repo = mockPositionRepository();
      const updater = new PositionExtremesUpdater(repo);

      // When / Then: find は undefined を返す
      expect(updater.find(PositionId.from(UUID_A))).toBeUndefined();
    });
  });

  describe('remove()', () => {
    it('remove 後の find は undefined を返す', async () => {
      // Given: 1 件 update 済み
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA, USD_JPY)]);
      const repo = mockPositionRepository(positions);
      const updater = new PositionExtremesUpdater(repo);
      await updater.update(USD_JPY, makeSnapshot('149.500', '149.505'));
      expect(updater.find(idA)).toBeDefined();

      // When: remove する
      updater.remove(idA);

      // Then: find は undefined
      expect(updater.find(idA)).toBeUndefined();
    });

    it('存在しない Position の remove は throw しない（冪等性）', () => {
      // Given: 何も追跡していない Updater
      const repo = mockPositionRepository();
      const updater = new PositionExtremesUpdater(repo);

      // When / Then: remove を 2 回呼んでも throw しない
      expect(() => updater.remove(PositionId.from(UUID_A))).not.toThrow();
      expect(() => updater.remove(PositionId.from(UUID_A))).not.toThrow();
    });
  });
});
