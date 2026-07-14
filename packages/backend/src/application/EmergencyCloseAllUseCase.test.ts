import { describe, it, expect, vi } from 'vitest';
import { EmergencyCloseAllUseCase } from './EmergencyCloseAllUseCase.js';
import { OpenPositions } from '../domain/position/OpenPositions.js';
import { Position } from '../domain/position/Position.js';
import { PositionId } from '../domain/position/PositionId.js';
import { CurrencyPair } from '../domain/market/CurrencyPair.js';
import { BuySell } from '../domain/market/BuySell.js';
import { Lot } from '../domain/position/Lot.js';
import { Price } from '../domain/market/Price.js';
import { Pips } from '../domain/market/Pips.js';
import { Timestamp } from '../domain/market/Timestamp.js';
import { ConvictionScore } from '../domain/market/ConvictionScore.js';
import { Money } from '../domain/Money.js';
import { EntrySnapshot } from '../domain/market/snapshot/EntrySnapshot.js';
import { EntryCommand } from '../domain/command/EntryCommand.js';
import { EntryReason } from '../domain/command/EntryReason.js';
import { EntryResult } from '../domain/market/EntryResult.js';
import { ExitResult } from '../domain/market/ExitResult.js';
import { ExitType } from '../domain/command/ExitCommand.js';
import { StrategyName } from '../domain/rule/StrategyName.js';
import type { Broker } from '../port/Broker.js';
import type { PositionRepository } from '../port/PositionRepository.js';

const USD_JPY = CurrencyPair('USD_JPY');
const T0 = new Date('2026-06-10T10:00:00Z');
const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

const DUMMY_ENTRY_SNAPSHOT = EntrySnapshot.of({
  convictionScore: '0.8',
  entryHour: 10,
  entryDayOfWeek: 1,
});

function makePosition(id: PositionId): Position {
  const command = EntryCommand.of({
    pair: USD_JPY,
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

const makeExitResult = (): ExitResult =>
  ExitResult.of({
    exitPrice: Price.of('151.000'),
    executedAt: Timestamp.of(T0),
    profitLoss: Pips.of('100.0'),
  });

const mockBroker = (): Broker => ({
  placeEntry: vi.fn(),
  placeExit: vi.fn().mockResolvedValue(makeExitResult()),
  fetchOpenPositionIds: vi.fn(),
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

describe('EmergencyCloseAllUseCase', () => {
  it('保有ポジションがなければ何もしない', async () => {
    // Given
    const broker = mockBroker();
    const repo = mockPositionRepository(OpenPositions.empty());
    const useCase = new EmergencyCloseAllUseCase(broker, repo);

    // When
    const result = await useCase.execute();

    // Then
    expect(result).toEqual({ total: 0, closed: [], errors: [], unresolved: [] });
    expect(broker.placeExit).not.toHaveBeenCalled();
  });

  it('全ポジションを決済し DB を更新して要約を返す', async () => {
    // Given: 2 件保有
    const idA = PositionId.from(UUID_A);
    const idB = PositionId.from(UUID_B);
    const broker = mockBroker();
    const repo = mockPositionRepository(
      OpenPositions.of([makePosition(idA), makePosition(idB)]),
    );
    const useCase = new EmergencyCloseAllUseCase(broker, repo);

    // When
    const result = await useCase.execute();

    // Then: 2 件とも決済・更新され、約定情報が要約に入る
    expect(result.total).toBe(2);
    expect(result.closed).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
    expect(broker.placeExit).toHaveBeenCalledTimes(2);
    expect(repo.update).toHaveBeenCalledTimes(2);
    expect(result.closed.map((c) => c.positionId).sort()).toEqual([UUID_A, UUID_B].sort());
    expect(result.closed[0]).toMatchObject({ exitPrice: '151', profitLoss: '100' });
  });

  it('決済を FORCE_CLOSE（強制クローズ）として永続化する', async () => {
    // Given: STOP_LOSS と混同するとトレード成績分析を汚染する
    const idA = PositionId.from(UUID_A);
    const broker = mockBroker();
    const repo = mockPositionRepository(OpenPositions.of([makePosition(idA)]));
    const useCase = new EmergencyCloseAllUseCase(broker, repo);

    // When
    await useCase.execute();

    // Then: update に渡る Position は CLOSED かつ exitType=FORCE_CLOSE
    const updated = vi.mocked(repo.update).mock.calls[0][0];
    expect(updated.status).toBe('CLOSED');
    expect(updated.exitType).toBe(ExitType.FORCE_CLOSE);
  });

  it('1 件の決済失敗で他のポジションの決済を止めない（best-effort）', async () => {
    // Given: A の決済は失敗、B は成功
    const idA = PositionId.from(UUID_A);
    const idB = PositionId.from(UUID_B);
    const broker = mockBroker();
    vi.mocked(broker.placeExit)
      .mockRejectedValueOnce(new Error('API エラー'))
      .mockResolvedValueOnce(makeExitResult());
    const repo = mockPositionRepository(
      OpenPositions.of([makePosition(idA), makePosition(idB)]),
    );
    const useCase = new EmergencyCloseAllUseCase(broker, repo);

    // When
    const result = await useCase.execute();

    // Then: 成功 1 件 + エラー 1 件（throw しない）。発注段階の失敗と分かる
    expect(result.total).toBe(2);
    expect(result.closed).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('発注失敗');
    expect(result.errors[0]).toContain('API エラー');
  });

  it('決済成立後の DB 更新失敗は「発注失敗」と区別してエラー記録する', async () => {
    // Given: placeExit は成功するが update が失敗
    const idA = PositionId.from(UUID_A);
    const broker = mockBroker();
    const repo = mockPositionRepository(OpenPositions.of([makePosition(idA)]));
    vi.mocked(repo.update).mockRejectedValue(new Error('DB エラー'));
    const useCase = new EmergencyCloseAllUseCase(broker, repo);

    // When
    const result = await useCase.execute();

    // Then: 操作者が「建玉は閉じている」と判断できるメッセージ
    expect(result.closed).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('決済成立済み・状態遷移/DB 更新失敗');
  });

  it('タイムアウトを超えたら途中結果で打ち切り、未決着を unresolved として返す', async () => {
    // Given: A は即時成功、B は永遠に完了しない（タイムアウト 50ms に短縮）
    const idA = PositionId.from(UUID_A);
    const idB = PositionId.from(UUID_B);
    const broker = mockBroker();
    vi.mocked(broker.placeExit).mockImplementation((position) =>
      position.id.equals(idA)
        ? Promise.resolve(makeExitResult())
        : new Promise(() => {}),
    );
    const repo = mockPositionRepository(
      OpenPositions.of([makePosition(idA), makePosition(idB)]),
    );
    const useCase = new EmergencyCloseAllUseCase(broker, repo, undefined, 50);

    // When
    const result = await useCase.execute();

    // Then: 部分結果が保持され、ハング分は結果不明として明示される
    expect(result.total).toBe(2);
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0].positionId).toBe(UUID_A);
    expect(result.errors).toHaveLength(0);
    expect(result.unresolved).toEqual([UUID_B]);
  });

  it('前回の決済注文が in-flight の間は再実行を拒否する（再入ガード）', async () => {
    // Given: 全件ハングする決済（1 回目はタイムアウトで返るが注文は未決着）
    const idA = PositionId.from(UUID_A);
    const broker = mockBroker();
    vi.mocked(broker.placeExit).mockReturnValue(new Promise(() => {}));
    const repo = mockPositionRepository(OpenPositions.of([makePosition(idA)]));
    const useCase = new EmergencyCloseAllUseCase(broker, repo, undefined, 50);

    // When: 1 回目はタイムアウト打ち切りで返る
    const first = await useCase.execute();
    expect(first.unresolved).toEqual([UUID_A]);

    // Then: 注文が未決着のままの再実行は拒否（同一ポジションへの二重発注防止）
    await expect(useCase.execute()).rejects.toThrow('既に実行中');
    expect(broker.placeExit).toHaveBeenCalledTimes(1);
  });

  it('全決済が決着すれば再実行できる（ガードの解放）', async () => {
    // Given: 正常に完了する決済
    const idA = PositionId.from(UUID_A);
    const broker = mockBroker();
    const repo = mockPositionRepository(OpenPositions.of([makePosition(idA)]));
    const useCase = new EmergencyCloseAllUseCase(broker, repo);

    // When: 1 回目が完了した後に 2 回目
    await useCase.execute();
    const second = await useCase.execute();

    // Then: 拒否されない
    expect(second.total).toBe(1);
  });
});
