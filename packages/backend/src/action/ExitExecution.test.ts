import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExitExecution } from './ExitExecution.js';
import { ExitCommand, ExitType } from '../domain/command/ExitCommand.js';
import { ExitReason } from '../domain/command/ExitReason.js';
import { ExitResult } from '../domain/market/ExitResult.js';
import { EntryCommand } from '../domain/command/EntryCommand.js';
import { EntryResult } from '../domain/market/EntryResult.js';
import { EntryReason } from '../domain/command/EntryReason.js';
import { Position } from '../domain/position/Position.js';
import { PositionId } from '../domain/position/PositionId.js';
import { CurrencyPair } from '../domain/market/CurrencyPair.js';
import { BuySell } from '../domain/market/BuySell.js';
import { Lot } from '../domain/position/Lot.js';
import { Price } from '../domain/market/Price.js';
import { Pips } from '../domain/market/Pips.js';
import { Timestamp } from '../domain/market/Timestamp.js';
import { ConvictionScore } from '../domain/market/ConvictionScore.js';
import { StrategyName } from '../domain/rule/StrategyName.js';
import { EntrySnapshot } from '../domain/market/snapshot/EntrySnapshot.js';
import { Money } from '../domain/Money.js';
import type { Broker } from '../port/Broker.js';
import type { PositionRepository } from '../port/PositionRepository.js';
import type { ExitCompensationQueuePort } from '../port/ExitCompensationQueuePort.js';
import type { LogPort } from '../domain/port/LogPort.js';

const DUMMY_SNAPSHOT = EntrySnapshot.of({ convictionScore: '0.5', entryHour: 12, entryDayOfWeek: 3 });

// ── テストヘルパー ──────────────────────────────────────────

const makePositionId = () => PositionId.generate();

const makePosition = (positionId = makePositionId()): Position => {
  const command = EntryCommand.of({
    pair: CurrencyPair('USD_JPY'),
    buySell: BuySell.BUY,
    lot: Lot.of(100),
    reason: EntryReason.of('SMAゴールデンクロス'),
    convictionScore: ConvictionScore.of('0.8'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: DUMMY_SNAPSHOT,
    requiredMargin: Money.jpy('600'),
  });
  const result = EntryResult.of({
    positionId,
    entryPrice: Price.of('150.500'),
    executedAt: Timestamp.of(new Date('2024-01-15T10:00:00.000Z')),
  });
  return Position.open(command, result);
};

const makeExitCommand = (positionId = makePositionId()): ExitCommand =>
  ExitCommand.of({
    positionId,
    type: ExitType.TAKE_PROFIT,
    reason: ExitReason.of('目標価格到達'),
  });

const makeExitResult = (): ExitResult =>
  ExitResult.of({
    exitPrice: Price.of('151.000'),
    executedAt: Timestamp.of(new Date('2024-01-15T11:00:00.000Z')),
    profitLoss: Pips.of('0.500'),
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

const mockCompensationQueue = (): ExitCompensationQueuePort => ({
  start: vi.fn(),
  stop: vi.fn(),
  enqueueUpdate: vi.fn(),
  enqueueMarkClosed: vi.fn(),
  has: vi.fn().mockReturnValue(false),
  size: vi.fn().mockReturnValue(0),
  drain: vi.fn(),
});

const mockLogger = (): LogPort => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// ── テスト ──────────────────────────────────────────────────

describe('ExitExecution', () => {
  let broker: Broker;
  let positionRepository: PositionRepository;
  let compensationQueue: ExitCompensationQueuePort;
  let logger: LogPort;
  let execution: ExitExecution;

  beforeEach(() => {
    broker = mockBroker();
    positionRepository = mockPositionRepository();
    compensationQueue = mockCompensationQueue();
    logger = mockLogger();
    execution = new ExitExecution(broker, positionRepository, compensationQueue, logger);
  });

  describe('closePosition()', () => {
    it('PositionRepository.findById() が command.positionId で呼ばれる', async () => {
      // Given: 決済対象のポジションとコマンドを用意
      const id = makePositionId();
      const command = makeExitCommand(id);
      const position = makePosition(id);
      vi.mocked(positionRepository.findById).mockResolvedValue(position);
      vi.mocked(broker.placeExit).mockResolvedValue(makeExitResult());

      // When: closePosition を実行
      await execution.closePosition(command);

      // Then: findById がコマンドの positionId で呼ばれている
      expect(positionRepository.findById).toHaveBeenCalledWith(id);
    });

    it('Broker.placeExit() が Position を引数に呼ばれる', async () => {
      // Given: 決済対象のポジションとコマンドを用意
      const id = makePositionId();
      const command = makeExitCommand(id);
      const position = makePosition(id);
      vi.mocked(positionRepository.findById).mockResolvedValue(position);
      vi.mocked(broker.placeExit).mockResolvedValue(makeExitResult());

      // When: closePosition を実行
      await execution.closePosition(command);

      // Then: placeExit に取得した Position が渡されている
      expect(broker.placeExit).toHaveBeenCalledWith(position);
    });

    it('Position.close(command, result) が呼ばれて状態が CLOSED になる', async () => {
      // Given: 決済対象のポジション（OPEN 状態）
      const id = makePositionId();
      const command = makeExitCommand(id);
      const position = makePosition(id);
      vi.mocked(positionRepository.findById).mockResolvedValue(position);
      vi.mocked(broker.placeExit).mockResolvedValue(makeExitResult());

      // When: closePosition を実行
      await execution.closePosition(command);

      // Then: ポジションの状態が CLOSED に遷移している
      expect(position.status).toBe('CLOSED');
    });

    it('PositionRepository.update() が決済後の Position で呼ばれる', async () => {
      // Given: 決済対象のポジションとコマンドを用意
      const id = makePositionId();
      const command = makeExitCommand(id);
      const position = makePosition(id);
      vi.mocked(positionRepository.findById).mockResolvedValue(position);
      vi.mocked(broker.placeExit).mockResolvedValue(makeExitResult());

      // When: closePosition を実行
      await execution.closePosition(command);

      // Then: update に渡された Position は CLOSED 状態
      expect(positionRepository.update).toHaveBeenCalledTimes(1);
      const updated = vi.mocked(positionRepository.update).mock.calls[0][0];
      expect(updated.status).toBe('CLOSED');
    });

    it('Broker.placeExit が失敗すると update は呼ばれない', async () => {
      // Given: Broker が決済エラーを返す
      const id = makePositionId();
      const command = makeExitCommand(id);
      const position = makePosition(id);
      vi.mocked(positionRepository.findById).mockResolvedValue(position);
      vi.mocked(broker.placeExit).mockRejectedValue(new Error('決済失敗'));

      // When / Then: エラーが伝搬し、update は呼ばれない（broker 未実行なので補償も不要）
      await expect(execution.closePosition(command)).rejects.toThrow('決済失敗');
      expect(positionRepository.update).not.toHaveBeenCalled();
      expect(compensationQueue.enqueueUpdate).not.toHaveBeenCalled();
      expect(compensationQueue.enqueueMarkClosed).not.toHaveBeenCalled();
    });

    it('findById が失敗すると placeExit と update は呼ばれない', async () => {
      // Given: ポジションが見つからない
      const command = makeExitCommand();
      vi.mocked(positionRepository.findById).mockRejectedValue(new Error('ポジションが見つかりません'));

      // When / Then: エラーが伝搬し、後続の処理は呼ばれない
      await expect(execution.closePosition(command)).rejects.toThrow('ポジションが見つかりません');
      expect(broker.placeExit).not.toHaveBeenCalled();
      expect(positionRepository.update).not.toHaveBeenCalled();
    });

    it('findById → placeExit → close → update の順序で実行される', async () => {
      // Given: 各 Port の呼び出し順序を記録する
      const id = makePositionId();
      const command = makeExitCommand(id);
      const position = makePosition(id);
      const callOrder: string[] = [];

      vi.mocked(positionRepository.findById).mockImplementation(async () => {
        callOrder.push('findById');
        return position;
      });
      vi.mocked(broker.placeExit).mockImplementation(async () => {
        callOrder.push('placeExit');
        return makeExitResult();
      });
      vi.mocked(positionRepository.update).mockImplementation(async () => {
        callOrder.push('update');
      });

      // When: closePosition を実行
      await execution.closePosition(command);

      // Then: 正しい順序で呼ばれている
      expect(callOrder).toEqual(['findById', 'placeExit', 'update']);
    });
  });

  describe('closePosition() 部分成功の補償（#186）', () => {
    it('broker 成功 + update 失敗は throw せず enqueueUpdate に登録される', async () => {
      // Given: placeExit は成功、DB update だけが失敗する
      const id = makePositionId();
      const command = makeExitCommand(id);
      const position = makePosition(id);
      vi.mocked(positionRepository.findById).mockResolvedValue(position);
      vi.mocked(broker.placeExit).mockResolvedValue(makeExitResult());
      vi.mocked(positionRepository.update).mockRejectedValue(new Error('DB 接続断'));

      // When: closePosition は正常終了する（決済は broker 側で確定済み）
      await expect(execution.closePosition(command)).resolves.toBeUndefined();

      // Then: CLOSED 遷移済みの集約が補償キューに登録され、error ログが出る
      expect(compensationQueue.enqueueUpdate).toHaveBeenCalledTimes(1);
      const enqueued = vi.mocked(compensationQueue.enqueueUpdate).mock.calls[0][0];
      expect(enqueued.status).toBe('CLOSED');
      expect(logger.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ event: 'exit_partial_success_detected', phase: 'update' }),
      );
    });

    it('broker 成功 + Position.close 失敗は throw せず enqueueMarkClosed に登録される', async () => {
      // Given: 既に CLOSED のポジション（close が不変条件違反で throw する状態）
      const id = makePositionId();
      const command = makeExitCommand(id);
      const position = makePosition(id);
      position.close(command, makeExitResult()); // 事前に CLOSED 化して二重 close を誘発
      vi.mocked(positionRepository.findById).mockResolvedValue(position);
      vi.mocked(broker.placeExit).mockResolvedValue(makeExitResult());

      // When
      await expect(execution.closePosition(command)).resolves.toBeUndefined();

      // Then: 縮退補償（markClosed）に登録され、update は呼ばれない
      expect(compensationQueue.enqueueMarkClosed).toHaveBeenCalledWith(id);
      expect(positionRepository.update).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ event: 'exit_partial_success_detected', phase: 'close' }),
      );
    });

    it('全段成功なら補償キューには触れない', async () => {
      // Given
      const id = makePositionId();
      const command = makeExitCommand(id);
      const position = makePosition(id);
      vi.mocked(positionRepository.findById).mockResolvedValue(position);
      vi.mocked(broker.placeExit).mockResolvedValue(makeExitResult());

      // When
      await execution.closePosition(command);

      // Then
      expect(compensationQueue.enqueueUpdate).not.toHaveBeenCalled();
      expect(compensationQueue.enqueueMarkClosed).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
