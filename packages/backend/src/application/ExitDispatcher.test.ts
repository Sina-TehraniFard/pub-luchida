import { describe, it, expect, vi } from 'vitest';
import { ExitDispatcher } from './ExitDispatcher.js';
import { ExitRuleRegistry } from '../domain/rule/ExitRuleRegistry.js';
import { ExitCommand, ExitType } from '../domain/command/ExitCommand.js';
import { DoNothing } from '../domain/command/DoNothing.js';
import { ExitReason } from '../domain/command/ExitReason.js';
import { StrategyName } from '../domain/rule/StrategyName.js';
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
import type { ExitRule } from '../domain/rule/ExitRule.js';
import type { ExtremesSnapshot } from '../domain/position/ExtremesSnapshot.js';
import type { LogPort } from '../domain/port/LogPort.js';
import type { PositionExtremesPort } from '../port/PositionExtremesPort.js';
import type { PositionRepository } from '../port/PositionRepository.js';
import type { ExitExecution } from '../action/ExitExecution.js';
import type { UiNotifier } from '../port/UiNotifier.js';
import type { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';
import type { ExitCompensationQueuePort } from '../port/ExitCompensationQueuePort.js';
import { ExitFailureCircuitBreaker } from '../domain/guard/ExitFailureCircuitBreaker.js';
import { ExitFailureThreshold } from '../domain/guard/ExitFailureThreshold.js';

const USD_JPY = CurrencyPair('USD_JPY');
const EUR_JPY = CurrencyPair('EUR_JPY');
const T0 = new Date('2026-05-15T10:00:00Z');
const T1 = new Date('2026-05-15T10:00:01Z');
const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

const DUMMY_ENTRY_SNAPSHOT = EntrySnapshot.of({
  convictionScore: '0.8',
  entryHour: 10,
  entryDayOfWeek: 1,
});

const DUMMY_MARKET_SNAPSHOT = {} as unknown as MarketSnapshot;

const defaultExtremes: ExtremesSnapshot = {
  highest: Price.of('150.100'),
  lowest: Price.of('149.900'),
};

function makePosition(
  id: PositionId,
  pair: CurrencyPair = USD_JPY,
  strategy: StrategyName = StrategyName.SMA_CROSS,
  openedAt: Date = T0,
): Position {
  const command = EntryCommand.of({
    pair,
    buySell: BuySell.BUY,
    lot: Lot.of(100),
    reason: EntryReason.of('test'),
    convictionScore: ConvictionScore.of('0.8'),
    strategyName: strategy,
    entrySnapshot: DUMMY_ENTRY_SNAPSHOT,
    requiredMargin: Money.jpy('600'),
  });
  const result = EntryResult.of({
    positionId: id,
    entryPrice: Price.of('150.000'),
    executedAt: Timestamp.of(openedAt),
  });
  return Position.open(command, result);
}

function makeExitCommand(positionId: PositionId): ExitCommand {
  return ExitCommand.of({
    positionId,
    type: ExitType.TAKE_PROFIT,
    reason: ExitReason.of('TP テスト'),
  });
}

const mockExitRule = (result: ExitCommand | DoNothing): ExitRule => ({
  shouldExit: vi.fn().mockReturnValue(result),
});

const mockExitRuleThrowing = (err: unknown): ExitRule => ({
  shouldExit: vi.fn().mockImplementation(() => {
    throw err;
  }),
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

const mockExitExecution = (
  closeBehavior: 'success' | 'throw' = 'success',
  err?: unknown,
): ExitExecution => ({
  closePosition:
    closeBehavior === 'throw'
      ? vi.fn().mockRejectedValue(err ?? new Error('closePosition error'))
      : vi.fn().mockResolvedValue(undefined),
} as unknown as ExitExecution);

const mockUiNotifier = (notifyBehavior: 'success' | 'throw' = 'success'): UiNotifier => ({
  notifyEntryReady: vi.fn(),
  notifyEntryExpired: vi.fn(),
  notifyExitExecuted:
    notifyBehavior === 'throw'
      ? vi.fn().mockRejectedValue(new Error('notify error'))
      : vi.fn().mockResolvedValue(undefined),
} as unknown as UiNotifier);

const mockExtremesPort = (
  snapshot: ExtremesSnapshot | undefined = defaultExtremes,
): PositionExtremesPort => ({
  find: vi.fn().mockReturnValue(snapshot),
  remove: vi.fn(),
});

const mockLogger = (): LogPort => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const mockCompensationQueue = (
  pendingIds: readonly PositionId[] = [],
): ExitCompensationQueuePort => ({
  start: vi.fn(),
  stop: vi.fn(),
  enqueueUpdate: vi.fn(),
  enqueueMarkClosed: vi.fn(),
  has: vi.fn().mockImplementation((id: PositionId) => pendingIds.some((p) => p.equals(id))),
  size: vi.fn().mockReturnValue(pendingIds.length),
  drain: vi.fn(),
});

// 既存テストの挙動を変えない素通し設定（閾値 99・クールダウンなし）
const makeBreaker = (threshold = 99, cooldownTicks = 0): ExitFailureCircuitBreaker =>
  new ExitFailureCircuitBreaker(ExitFailureThreshold.of(threshold), cooldownTicks);

const countErrorCallsByEvent = (logger: LogPort, event: string): number => {
  const calls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
  return calls.filter(([, ctx]) => (ctx as { event?: string })?.event === event).length;
};

describe('ExitDispatcher', () => {
  describe('dispatch()', () => {
    it('pair-bound: 他 pair の Position は評価されない', async () => {
      // Given: USD_JPY と EUR_JPY のポジション
      const idUsd = PositionId.from(UUID_A);
      const idEur = PositionId.from(UUID_B);
      const positions = OpenPositions.of([
        makePosition(idUsd, USD_JPY),
        makePosition(idEur, EUR_JPY),
      ]);
      const repo = mockPositionRepository(positions);
      const smaRule = mockExitRule(DoNothing.instance);
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaRule]]);
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When: USD_JPY で dispatch
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then: smaRule は USD_JPY ポジションのみ評価（1 回）
      expect(smaRule.shouldExit).toHaveBeenCalledTimes(1);
    });

    it('戦略別 lookup: 戦略 A の Position は 戦略 A の Rule のみ評価', async () => {
      // Given: SMA_CROSS と RSI_REVERSAL のポジション各 1 件
      const idA = PositionId.from(UUID_A);
      const idB = PositionId.from(UUID_B);
      const positions = OpenPositions.of([
        makePosition(idA, USD_JPY, StrategyName.SMA_CROSS),
        makePosition(idB, USD_JPY, StrategyName.RSI_REVERSAL, T1),
      ]);
      const repo = mockPositionRepository(positions);
      const smaRule = mockExitRule(DoNothing.instance);
      const rsiRule = mockExitRule(DoNothing.instance);
      const registry = ExitRuleRegistry.of([
        [StrategyName.SMA_CROSS, smaRule],
        [StrategyName.RSI_REVERSAL, rsiRule],
      ]);
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then: 各 Rule は対応戦略のポジションのみ評価
      expect(smaRule.shouldExit).toHaveBeenCalledTimes(1);
      expect(rsiRule.shouldExit).toHaveBeenCalledTimes(1);
    });

    it('未登録戦略は warn + skipped(rule_missing)', async () => {
      // Given: SMA_CROSS のみ登録、Position は RSI_REVERSAL
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([
        makePosition(idA, USD_JPY, StrategyName.RSI_REVERSAL),
      ]);
      const repo = mockPositionRepository(positions);
      const smaRule = mockExitRule(DoNothing.instance);
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaRule]]);
      const logger = mockLogger();
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        logger,
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.reason).toBe('rule_missing');
      expect(result.hasPermanentSkip()).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ event: 'exit_rule_missing' }),
      );
    });

    it('Registry.findRule 自体が想定外 throw した場合は dispatch 全体が rejects', async () => {
      // Given: Registry の findRule が TypeError を throw する細工
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const brokenRegistry = {
        findRule: vi.fn().mockImplementation(() => {
          throw new TypeError('想定外');
        }),
      } as unknown as ExitRuleRegistry;
      const dispatcher = new ExitDispatcher(
        brokenRegistry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When / Then
      await expect(dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT)).rejects.toThrow(TypeError);
    });

    it('rule.shouldExit throw は error + failed 記録 + 他評価継続（event: exit_dispatch_failed）', async () => {
      // Given: ポジション 2 件、SMA_CROSS のみ登録、最初が throw する Rule
      const idA = PositionId.from(UUID_A);
      const idB = PositionId.from(UUID_B);
      const positions = OpenPositions.of([
        makePosition(idA, USD_JPY, StrategyName.SMA_CROSS, T0),
        makePosition(idB, USD_JPY, StrategyName.RSI_REVERSAL, T1),
      ]);
      const repo = mockPositionRepository(positions);
      const throwingRule = mockExitRuleThrowing(new Error('rule error'));
      const okRule = mockExitRule(DoNothing.instance);
      const registry = ExitRuleRegistry.of([
        [StrategyName.SMA_CROSS, throwingRule],
        [StrategyName.RSI_REVERSAL, okRule],
      ]);
      const logger = mockLogger();
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        logger,
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.errorName).toBe('Error');
      expect(okRule.shouldExit).toHaveBeenCalledTimes(1);
      expect(countErrorCallsByEvent(logger, 'exit_dispatch_failed')).toBe(1);
    });

    it('closePosition throw は failed 記録 + uiNotifier / remove 呼ばれない', async () => {
      // Given: ExitCommand 発火 + closePosition が throw
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const smaRule = mockExitRule(makeExitCommand(idA));
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaRule]]);
      const execution = mockExitExecution('throw');
      const notifier = mockUiNotifier();
      const extremesPort = mockExtremesPort();
      const logger = mockLogger();
      const dispatcher = new ExitDispatcher(registry, repo, execution, notifier, extremesPort, logger,
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(result.failed).toHaveLength(1);
      expect(notifier.notifyExitExecuted).not.toHaveBeenCalled();
      expect(extremesPort.remove).not.toHaveBeenCalled();
      expect(countErrorCallsByEvent(logger, 'exit_dispatch_failed')).toBe(1);
    });

    it('notifyExitExecuted throw でも closed に積まれ remove も呼ばれる', async () => {
      // Given
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const smaRule = mockExitRule(makeExitCommand(idA));
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaRule]]);
      const notifier = mockUiNotifier('throw');
      const extremesPort = mockExtremesPort();
      const logger = mockLogger();
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        notifier,
        extremesPort,
        logger,
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(result.closed).toHaveLength(1);
      expect(extremesPort.remove).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ event: 'exit_notify_failed' }),
      );
    });

    it('評価順は openedAt 昇順', async () => {
      // Given: T1 → T0 の順で投入
      const idA = PositionId.from(UUID_A);
      const idB = PositionId.from(UUID_B);
      const positions = OpenPositions.of([
        makePosition(idB, USD_JPY, StrategyName.SMA_CROSS, T1),
        makePosition(idA, USD_JPY, StrategyName.SMA_CROSS, T0),
      ]);
      const repo = mockPositionRepository(positions);
      const recordedOrder: string[] = [];
      const smaRule: ExitRule = {
        shouldExit: vi.fn().mockImplementation((_snap, p: Position) => {
          recordedOrder.push(p.id.toString());
          return DoNothing.instance;
        }),
      };
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaRule]]);
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then: T0 → T1（古い順）
      expect(recordedOrder).toEqual([UUID_A, UUID_B]);
    });

    it('ExitCommand 発火 + 決済成功で closed.push + closePosition が cmd, extremes で呼ばれ + extremesPort.remove', async () => {
      // Given
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const cmd = makeExitCommand(idA);
      const smaRule = mockExitRule(cmd);
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaRule]]);
      const execution = mockExitExecution();
      const extremesPort = mockExtremesPort();
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        execution,
        mockUiNotifier(),
        extremesPort,
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then: closePosition は (ExitCommand, ExtremesSnapshot) で呼ばれる
      expect(execution.closePosition).toHaveBeenCalledWith(cmd, defaultExtremes);
      expect(result.closed).toEqual([idA]);
      expect(extremesPort.remove).toHaveBeenCalledTimes(1);
    });

    it('find が undefined のとき skipped(extremes_unavailable) + closePosition 呼ばれない + remove 呼ばれない', async () => {
      // Given: extremes 未追跡
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const smaRule = mockExitRule(makeExitCommand(idA));
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaRule]]);
      const execution = mockExitExecution();
      const extremesPort: PositionExtremesPort = {
        find: vi.fn().mockReturnValue(undefined),
        remove: vi.fn(),
      };
      const logger = mockLogger();
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        execution,
        mockUiNotifier(),
        extremesPort,
        logger,
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.reason).toBe('extremes_unavailable');
      expect(execution.closePosition).not.toHaveBeenCalled();
      expect(extremesPort.remove).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ event: 'exit_extremes_unavailable' }),
      );
    });

    it('DoNothing 返却時は closePosition 呼ばれない / closed/skipped/failed いずれにも積まれない', async () => {
      // Given
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const smaRule = mockExitRule(DoNothing.instance);
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaRule]]);
      const execution = mockExitExecution();
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        execution,
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(result.closed).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(execution.closePosition).not.toHaveBeenCalled();
    });

    it('集計: closed/skipped/failed の件数と中身が正しい', async () => {
      // Given: 4 ポジション
      const idClose = PositionId.from('a-close');
      const idRuleMiss = PositionId.from('b-miss');
      const idExtremesNo = PositionId.from('c-no-extremes');
      const idFail = PositionId.from('d-fail');
      const positions = OpenPositions.of([
        makePosition(idClose, USD_JPY, StrategyName.SMA_CROSS, T0),
        makePosition(idRuleMiss, USD_JPY, StrategyName.RSI_REVERSAL, new Date('2026-05-15T10:00:02Z')),
        makePosition(idExtremesNo, USD_JPY, StrategyName.SMA_DISTANCE, new Date('2026-05-15T10:00:03Z')),
        makePosition(idFail, USD_JPY, StrategyName.WICK_REVERSAL, new Date('2026-05-15T10:00:04Z')),
      ]);
      const repo = mockPositionRepository(positions);

      const ruleClose = mockExitRule(makeExitCommand(idClose));
      const ruleExtremesNo = mockExitRule(makeExitCommand(idExtremesNo));
      const ruleFail = mockExitRuleThrowing(new Error('boom'));

      const registry = ExitRuleRegistry.of([
        [StrategyName.SMA_CROSS, ruleClose],
        [StrategyName.SMA_DISTANCE, ruleExtremesNo],
        [StrategyName.WICK_REVERSAL, ruleFail],
      ]);

      const extremesPort: PositionExtremesPort = {
        find: vi.fn().mockImplementation((id: PositionId) => {
          if (id.equals(idExtremesNo)) return undefined;
          return defaultExtremes;
        }),
        remove: vi.fn(),
      };

      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        extremesPort,
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(result.closed).toEqual([idClose]);
      expect(result.skipped).toHaveLength(2);
      expect(result.skipped.find((s) => s.positionId.equals(idRuleMiss))?.reason).toBe('rule_missing');
      expect(result.skipped.find((s) => s.positionId.equals(idExtremesNo))?.reason).toBe(
        'extremes_unavailable',
      );
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.positionId.equals(idFail)).toBe(true);
    });

    it('VO 整合: failed/skipped の strategy は StrategyName VO（branded string）のまま', async () => {
      // Given
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA, USD_JPY, StrategyName.SMA_CROSS)]);
      const repo = mockPositionRepository(positions);
      const throwingRule = mockExitRuleThrowing(new Error('e'));
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, throwingRule]]);
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(result.failed[0]?.strategy).toBe(StrategyName.SMA_CROSS);
    });

    it('非 Error throw 時の errorName は Unknown', async () => {
      // Given
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const throwingRule = mockExitRuleThrowing('string error');
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, throwingRule]]);
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(result.failed[0]?.errorName).toBe('Unknown');
    });

    it('rule.shouldExit が別 Position の ExitCommand を返したら throw（fail-fast）', async () => {
      // Given: Rule は position.id とは別の positionId を持つ ExitCommand を返す
      const idA = PositionId.from(UUID_A);
      const otherId = PositionId.from(UUID_B);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const wrongCmd = makeExitCommand(otherId);  // idA のはずが otherId
      const smaRule = mockExitRule(wrongCmd);
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaRule]]);
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then: failed に積まれ、errorName は Error（別 Position 検知 throw が捕捉された）
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.errorName).toBe('Error');
      expect(result.closed).toHaveLength(0);
    });

    it('生 Error throw 時の errorName は Error', async () => {
      // Given
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const throwingRule = mockExitRuleThrowing(new Error('plain'));
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, throwingRule]]);
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(result.failed[0]?.errorName).toBe('Error');
    });

  });

  describe('dispatch() 決済失敗への防御（#186）', () => {
    it('補償待ちポジションは skipped(compensation_pending) で再決済されない（シールド）', async () => {
      // Given: idA は broker 決済済み・DB 反映待ち（補償キューに登録済み）
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const smaRule = mockExitRule(makeExitCommand(idA));
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaRule]]);
      const execution = mockExitExecution();
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        execution,
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue([idA]),
        makeBreaker(),
      );

      // When
      const result = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then: 評価も決済もされない
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.reason).toBe('compensation_pending');
      expect(smaRule.shouldExit).not.toHaveBeenCalled();
      expect(execution.closePosition).not.toHaveBeenCalled();
    });

    it('失敗直後の tick は skipped(failure_cooldown) で再試行が間引かれる', async () => {
      // Given: クールダウン 5 tick の breaker と、常に throw する Rule
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const throwingRule = mockExitRuleThrowing(new Error('決済失敗'));
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, throwingRule]]);
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        makeBreaker(99, 5),
      );

      // When: 1 tick 目は失敗、2 tick 目はクールダウン
      const first = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);
      const second = await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(first.failed).toHaveLength(1);
      expect(second.skipped).toHaveLength(1);
      expect(second.skipped[0]?.reason).toBe('failure_cooldown');
      expect(throwingRule.shouldExit).toHaveBeenCalledTimes(1);
    });

    it('exit_dispatch_failed ログに consecutiveFailures が載る', async () => {
      // Given: クールダウンなし（毎 tick 再試行）で 2 回失敗させる
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const throwingRule = mockExitRuleThrowing(new Error('決済失敗'));
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, throwingRule]]);
      const logger = mockLogger();
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        logger,
        mockCompensationQueue(),
        makeBreaker(99, 0),
      );

      // When
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then: 2 回目のログは consecutiveFailures=2
      expect(logger.error).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ event: 'exit_dispatch_failed', consecutiveFailures: 2 }),
      );
    });

    it('連続失敗が閾値に達すると breaker.shouldKill() が真になる（kill-switch 判定材料）', async () => {
      // Given: 閾値 3・クールダウンなし
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const throwingRule = mockExitRuleThrowing(new Error('決済失敗'));
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, throwingRule]]);
      const breaker = makeBreaker(3, 0);
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        breaker,
      );

      // When / Then
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);
      expect(breaker.shouldKill()).toBe(false);
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);
      expect(breaker.shouldKill()).toBe(true);
      expect(breaker.killDetail()?.positionId).toBe(UUID_A);
    });

    it('決済成功で連続失敗カウントはリセットされる', async () => {
      // Given: 1 回目は throw、2 回目は ExitCommand 成功、3 回目は throw する Rule
      const idA = PositionId.from(UUID_A);
      const positions = OpenPositions.of([makePosition(idA)]);
      const repo = mockPositionRepository(positions);
      const cmd = makeExitCommand(idA);
      const rule: ExitRule = {
        shouldExit: vi
          .fn()
          .mockImplementationOnce(() => {
            throw new Error('1回目失敗');
          })
          .mockReturnValueOnce(cmd)
          .mockImplementationOnce(() => {
            throw new Error('3回目失敗');
          }),
      };
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, rule]]);
      const breaker = makeBreaker(2, 0);
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        breaker,
      );

      // When: 失敗 → 成功 → 失敗（成功時にリセットされるので閾値 2 に届かない）
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(breaker.shouldKill()).toBe(false);
    });

    it('OPEN 集合から消えたポジションの失敗記録は掃除される（定期 sync による解消）', async () => {
      // Given: 閾値 2・クールダウンなしで 2 回失敗 → kill 判定に達する
      const idA = PositionId.from(UUID_A);
      const repo = mockPositionRepository(OpenPositions.of([makePosition(idA)]));
      const throwingRule = mockExitRuleThrowing(new Error('決済失敗'));
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, throwingRule]]);
      const breaker = makeBreaker(2, 0);
      const dispatcher = new ExitDispatcher(
        registry,
        repo,
        mockExitExecution(),
        mockUiNotifier(),
        mockExtremesPort(),
        mockLogger(),
        mockCompensationQueue(),
        breaker,
      );
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);
      expect(breaker.shouldKill()).toBe(true);

      // When: sync が DB を直して OPEN 集合から消えた後の tick
      (repo.openPositions as ReturnType<typeof vi.fn>).mockResolvedValue(OpenPositions.empty());
      await dispatcher.dispatch(USD_JPY, DUMMY_MARKET_SNAPSHOT);

      // Then: kill 判定は解除される
      expect(breaker.shouldKill()).toBe(false);
    });
  });
});
