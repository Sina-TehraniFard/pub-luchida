import { describe, it, expect, vi } from 'vitest';
import { SyncPositionsUseCase } from './SyncPositionsUseCase.js';
import { OpenPositions } from '../domain/position/OpenPositions.js';
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
import type { Broker } from '../port/Broker.js';
import type { PositionRepository } from '../port/PositionRepository.js';
import type { AuthFailureReportPort } from '../domain/port/AuthFailureReportPort.js';
import { BrokerError } from '../domain/error/BrokerError.js';

const USD_JPY = CurrencyPair('USD_JPY');
const T0 = new Date('2026-06-10T10:00:00Z');
const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

const DUMMY_ENTRY_SNAPSHOT = EntrySnapshot.of({
  convictionScore: '0.8',
  entryHour: 10,
  entryDayOfWeek: 1,
});

function makePosition(id: PositionId, pair: CurrencyPair = USD_JPY): Position {
  const command = EntryCommand.of({
    pair,
    buySell: BuySell.BUY,
    lot: Lot.of(100),
    reason: EntryReason.of('SMA クロス'),
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

const mockBroker = (brokerIds: PositionId[]): Broker => ({
  placeEntry: vi.fn(),
  placeExit: vi.fn(),
  fetchOpenPositionIds: vi.fn().mockResolvedValue(brokerIds),
  verifyConnectivity: vi.fn(),
});

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

describe('SyncPositionsUseCase', () => {
  it('ブローカーと DB が一致していれば何も更新しない', async () => {
    // Given: 同じポジションが両方に存在
    const idA = PositionId.from(UUID_A);
    const broker = mockBroker([idA]);
    const repo = mockPositionRepository(OpenPositions.of([makePosition(idA)]));
    const useCase = new SyncPositionsUseCase(USD_JPY, broker, repo);

    // When
    const result = await useCase.execute();

    // Then
    expect(result).toEqual({ dbOpen: 1, brokerOpen: 1, synced: 0 });
    expect(repo.markClosed).not.toHaveBeenCalled();
  });

  it('ブローカーに存在しない DB ポジションを CLOSED に更新する', async () => {
    // Given: DB に 2 件、ブローカーには A のみ存在（B は外部で決済済み）
    const idA = PositionId.from(UUID_A);
    const idB = PositionId.from(UUID_B);
    const broker = mockBroker([idA]);
    const repo = mockPositionRepository(
      OpenPositions.of([makePosition(idA), makePosition(idB)]),
    );
    const useCase = new SyncPositionsUseCase(USD_JPY, broker, repo);

    // When
    const result = await useCase.execute();

    // Then: B だけが CLOSED に更新される
    expect(result).toEqual({ dbOpen: 2, brokerOpen: 1, synced: 1 });
    expect(repo.markClosed).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.markClosed).mock.calls[0][0].equals(idB)).toBe(true);
  });

  it('DB が空なら何もしない', async () => {
    // Given: ブローカーに建玉があっても DB 側が空（手動取引等）
    const broker = mockBroker([PositionId.from(UUID_A)]);
    const repo = mockPositionRepository(OpenPositions.empty());
    const useCase = new SyncPositionsUseCase(USD_JPY, broker, repo);

    // When
    const result = await useCase.execute();

    // Then: ブローカー側のみの建玉は対象外（片方向同期）
    expect(result).toEqual({ dbOpen: 0, brokerOpen: 1, synced: 0 });
    expect(repo.markClosed).not.toHaveBeenCalled();
  });

  it('建玉照会が失敗したらエラーを伝播し DB を更新しない', async () => {
    // Given: ブローカー照会がエラー
    const broker = mockBroker([]);
    vi.mocked(broker.fetchOpenPositionIds).mockRejectedValue(new Error('API エラー'));
    const repo = mockPositionRepository(
      OpenPositions.of([makePosition(PositionId.from(UUID_A))]),
    );
    const useCase = new SyncPositionsUseCase(USD_JPY, broker, repo);

    // When / Then: 照会失敗時に「全件ブローカー不在」と誤認して CLOSED 化しない
    await expect(useCase.execute()).rejects.toThrow('API エラー');
    expect(repo.markClosed).not.toHaveBeenCalled();
  });

  it('markClosed が失敗したらエラーを伝播する（fail-fast。次回 sync で再試行）', async () => {
    // Given: ブローカーに存在しないポジションがあり、CLOSED 更新が DB エラー
    const idA = PositionId.from(UUID_A);
    const broker = mockBroker([]);
    const repo = mockPositionRepository(OpenPositions.of([makePosition(idA)]));
    vi.mocked(repo.markClosed).mockRejectedValue(new Error('DB エラー'));
    const useCase = new SyncPositionsUseCase(USD_JPY, broker, repo);

    // When / Then
    await expect(useCase.execute()).rejects.toThrow('DB エラー');
  });

  it('別ペアのポジションは同期対象外（pair-bound 評価）', async () => {
    // Given: USD_JPY の同期。DB には EUR_JPY のポジションのみ存在
    const idEur = PositionId.from(UUID_B);
    const broker = mockBroker([]);
    const repo = mockPositionRepository(
      OpenPositions.of([makePosition(idEur, CurrencyPair('EUR_JPY'))]),
    );
    const useCase = new SyncPositionsUseCase(USD_JPY, broker, repo);

    // When
    const result = await useCase.execute();

    // Then: 別ペアは「ブローカー照会の対象外」なので不在と誤判定しない
    expect(result).toEqual({ dbOpen: 0, brokerOpen: 0, synced: 0 });
    expect(repo.markClosed).not.toHaveBeenCalled();
  });

  it('DB 読み取り後にブローカーへ照会する（照会中の新規約定を誤 CLOSED しない順序保証）', async () => {
    // Given
    const broker = mockBroker([]);
    const repo = mockPositionRepository();
    const useCase = new SyncPositionsUseCase(USD_JPY, broker, repo);

    // When
    await useCase.execute();

    // Then: openPositions（DB）→ fetchOpenPositionIds（ブローカー）の順
    const dbOrder = vi.mocked(repo.openPositions).mock.invocationCallOrder[0];
    const brokerOrder = vi.mocked(broker.fetchOpenPositionIds).mock.invocationCallOrder[0];
    expect(dbOrder).toBeLessThan(brokerOrder);
  });

  it('指定した pair でブローカーに照会する', async () => {
    // Given
    const broker = mockBroker([]);
    const repo = mockPositionRepository();
    const useCase = new SyncPositionsUseCase(USD_JPY, broker, repo);

    // When
    await useCase.execute();

    // Then
    expect(broker.fetchOpenPositionIds).toHaveBeenCalledWith(USD_JPY);
  });

  describe('番人への認証成否報告（#290 Step2）', () => {
    const mockReporter = (): AuthFailureReportPort => ({ report: vi.fn() });

    it('照会成功なら succeeded を報告する', async () => {
      // Given
      const broker = mockBroker([]);
      const repo = mockPositionRepository();
      const reporter = mockReporter();
      const useCase = new SyncPositionsUseCase(USD_JPY, broker, repo, undefined, reporter);

      // When
      await useCase.execute();

      // Then: 成功（isFailure=false）を報告
      expect(reporter.report).toHaveBeenCalledTimes(1);
      const reported = vi.mocked(reporter.report).mock.calls[0][0];
      expect(reported.isFailure()).toBe(false);
    });

    it('認証失敗（BrokerError AUTHENTICATION_FAILED）なら failed を報告して伝播する', async () => {
      // Given: 照会が認証失敗
      const broker = mockBroker([]);
      vi.mocked(broker.fetchOpenPositionIds).mockRejectedValue(BrokerError.authenticationFailed());
      const repo = mockPositionRepository(OpenPositions.of([makePosition(PositionId.from(UUID_A))]));
      const reporter = mockReporter();
      const useCase = new SyncPositionsUseCase(USD_JPY, broker, repo, undefined, reporter);

      // When / Then
      await expect(useCase.execute()).rejects.toBeInstanceOf(BrokerError);
      expect(reporter.report).toHaveBeenCalledTimes(1);
      const reported = vi.mocked(reporter.report).mock.calls[0][0];
      expect(reported.isFailure()).toBe(true);
      // DB は更新しない
      expect(repo.markClosed).not.toHaveBeenCalled();
    });

    it('認証以外の失敗（NETWORK_ERROR 等）は報告しない（カウント中立）', async () => {
      // Given: 通信断
      const broker = mockBroker([]);
      vi.mocked(broker.fetchOpenPositionIds).mockRejectedValue(BrokerError.networkError());
      const repo = mockPositionRepository(OpenPositions.of([makePosition(PositionId.from(UUID_A))]));
      const reporter = mockReporter();
      const useCase = new SyncPositionsUseCase(USD_JPY, broker, repo, undefined, reporter);

      // When / Then: 報告は来ない（番人の連続カウントを進めも戻しもしない）
      await expect(useCase.execute()).rejects.toBeInstanceOf(BrokerError);
      expect(reporter.report).not.toHaveBeenCalled();
    });
  });
});
