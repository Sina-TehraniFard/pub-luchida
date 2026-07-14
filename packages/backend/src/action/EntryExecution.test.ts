import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntryExecution } from './EntryExecution.js';
import { EntryCommand } from '../domain/command/EntryCommand.js';
import { EntryResult } from '../domain/market/EntryResult.js';
import { EntryReason } from '../domain/command/EntryReason.js';
import { Position } from '../domain/position/Position.js';
import { PositionId } from '../domain/position/PositionId.js';
import { CurrencyPair } from '../domain/market/CurrencyPair.js';
import { BuySell } from '../domain/market/BuySell.js';
import { Lot } from '../domain/position/Lot.js';
import { Price } from '../domain/market/Price.js';
import { Timestamp } from '../domain/market/Timestamp.js';
import { ConvictionScore } from '../domain/market/ConvictionScore.js';
import { StrategyName } from '../domain/rule/StrategyName.js';
import { EntrySnapshot } from '../domain/market/snapshot/EntrySnapshot.js';
import { Money } from '../domain/Money.js';
import type { Broker } from '../port/Broker.js';
import type { PositionRepository } from '../port/PositionRepository.js';

const DUMMY_SNAPSHOT = EntrySnapshot.of({ convictionScore: '0.5', entryHour: 12, entryDayOfWeek: 3 });

// ── テストヘルパー ──────────────────────────────────────────

const makeCommand = (): EntryCommand =>
  EntryCommand.of({
    pair: CurrencyPair('USD_JPY'),
    buySell: BuySell.BUY,
    lot: Lot.of(100),
    reason: EntryReason.of('SMAゴールデンクロス'),
    convictionScore: ConvictionScore.of('0.8'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: DUMMY_SNAPSHOT,
    requiredMargin: Money.jpy('600'),
  });

const makeResult = (): EntryResult =>
  EntryResult.of({
    positionId: PositionId.generate(),
    entryPrice: Price.of('150.500'),
    executedAt: Timestamp.of(new Date('2024-01-15T10:00:00.000Z')),
  });

// ── モック ──────────────────────────────────────────────────

const mockBroker = (): Broker => ({
  placeEntry: vi.fn(),
  placeExit: vi.fn(),
  fetchOpenPositionIds: vi.fn(),
  verifyConnectivity: vi.fn(),
});

const mockPositionRepository = (): PositionRepository => ({
  register: vi.fn(),
  update: vi.fn(),
  findById: vi.fn(),
  openPositions: vi.fn(),
  findOpenByPairAndStrategy: vi.fn(),
  markClosed: vi.fn(),
});

// ── テスト ──────────────────────────────────────────────────

describe('EntryExecution', () => {
  let broker: Broker;
  let positionRepository: PositionRepository;
  let execution: EntryExecution;

  beforeEach(() => {
    broker = mockBroker();
    positionRepository = mockPositionRepository();
    execution = new EntryExecution(broker, positionRepository);
  });

  describe('openPosition()', () => {
    it('Broker.placeEntry() が EntryCommand を引数に呼ばれる', async () => {
      // Given: EntryCommand と EntryResult を準備
      const command = makeCommand();
      const result = makeResult();
      vi.mocked(broker.placeEntry).mockResolvedValue(result);

      // When: openPosition を呼ぶ
      await execution.openPosition(command);

      // Then: Broker.placeEntry が command を引数に呼ばれている
      expect(broker.placeEntry).toHaveBeenCalledWith(command);
    });

    it('PositionRepository.register() が Position を引数に呼ばれる', async () => {
      // Given: エントリーコマンドと約定結果を用意
      const command = makeCommand();
      const result = makeResult();
      vi.mocked(broker.placeEntry).mockResolvedValue(result);

      // When: openPosition を実行
      await execution.openPosition(command);

      // Then: register が呼ばれ、引数は Position
      expect(positionRepository.register).toHaveBeenCalledTimes(1);
      const registered = vi.mocked(positionRepository.register).mock.calls[0][0];
      expect(registered).toBeInstanceOf(Position);
    });

    it('登録された Position の id が EntryResult の positionId と一致する', async () => {
      // Given: エントリーコマンドと約定結果を用意
      const command = makeCommand();
      const result = makeResult();
      vi.mocked(broker.placeEntry).mockResolvedValue(result);

      // When: openPosition を実行
      await execution.openPosition(command);

      // Then: 登録された Position の id が約定結果の positionId と一致
      const registered = vi.mocked(positionRepository.register).mock.calls[0][0];
      expect(registered.id.equals(result.positionId)).toBe(true);
    });

    it('登録された Position の buySell と pair が command と一致する', async () => {
      // Given: エントリーコマンドと約定結果を用意
      const command = makeCommand();
      const result = makeResult();
      vi.mocked(broker.placeEntry).mockResolvedValue(result);

      // When: openPosition を実行
      await execution.openPosition(command);

      // Then: Position の通貨ペアと売買方向がコマンドと一致
      const registered = vi.mocked(positionRepository.register).mock.calls[0][0];
      expect(registered.pair).toBe(command.pair);
      expect(registered.buySell).toBe(command.buySell);
    });

    it('Broker.placeEntry が失敗すると register は呼ばれない', async () => {
      // Given: Broker がエラーを返す
      const command = makeCommand();
      vi.mocked(broker.placeEntry).mockRejectedValue(new Error('注文失敗'));

      // When / Then: openPosition がエラーをスロー
      await expect(execution.openPosition(command)).rejects.toThrow('注文失敗');
      expect(positionRepository.register).not.toHaveBeenCalled();
    });
  });
});
