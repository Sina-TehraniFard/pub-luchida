import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PositionManager } from './PositionManager.js';
import type { EntryRule } from '../domain/rule/EntryRule.js';
import type { AllocationPolicy } from '../domain/allocation/AllocationPolicy.js';
import type { PositionSizingService } from './PositionSizingService.js';
import type { EntryQueuePort } from '../port/EntryQueuePort.js';
import type { PositionRepository } from '../port/PositionRepository.js';
import type { BalancePort } from '../port/BalancePort.js';
import type { UiNotifier } from '../port/UiNotifier.js';
import type { Clock } from '../port/Clock.js';
import type { LogPort } from '../domain/port/LogPort.js';
import { EntryCommand } from '../domain/command/EntryCommand.js';
import { DoNothing } from '../domain/command/DoNothing.js';
import { EntryReason } from '../domain/command/EntryReason.js';
import { CurrencyPair } from '../domain/market/CurrencyPair.js';
import { BuySell } from '../domain/market/BuySell.js';
import { Lot } from '../domain/position/Lot.js';
import { Price } from '../domain/market/Price.js';
import { Timestamp } from '../domain/market/Timestamp.js';
import { Rate } from '../domain/market/Rate.js';
import { ConvictionScore } from '../domain/market/ConvictionScore.js';
import { Money } from '../domain/Money.js';
import { Balance } from '../domain/Balance.js';
import { Ratio } from '../domain/Ratio.js';
import { MarginRate } from '../domain/position/MarginRate.js';
import { StrategyName } from '../domain/rule/StrategyName.js';
import { EntrySnapshot } from '../domain/market/snapshot/EntrySnapshot.js';
import type { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';
import { OpenPositions } from '../domain/position/OpenPositions.js';
import { Position } from '../domain/position/Position.js';
import { PositionId } from '../domain/position/PositionId.js';
import { EntryResult } from '../domain/market/EntryResult.js';
import { LotAllocation } from '../domain/allocation/LotAllocation.js';
import { SizingResult } from '../domain/position/SizingResult.js';
import { NoopEntryDecisionObserver } from '../port/EntryDecisionObserverPort.js';
import type { EntryAdmissionPort } from '../domain/port/EntryAdmissionPort.js';
import { EntryAdmission } from '../domain/guard/EntryAdmission.js';

const PAIR = CurrencyPair('USD_JPY');
const T0 = new Date('2026-05-11T10:00:00Z');
const DUMMY_SNAPSHOT = EntrySnapshot.of({
  convictionScore: '0.8',
  entryHour: 10,
  entryDayOfWeek: 1,
});
const MARGIN_RATE = MarginRate.of('0.04');
const DUMMY_MARKET_SNAPSHOT = {} as unknown as MarketSnapshot;

const makeCommand = (
  strategy: StrategyName,
  lot: Lot = Lot.of(100),
): EntryCommand =>
  EntryCommand.of({
    pair: PAIR,
    buySell: BuySell.BUY,
    lot,
    reason: EntryReason.of('test'),
    convictionScore: ConvictionScore.of('0.8'),
    strategyName: strategy,
    entrySnapshot: DUMMY_SNAPSHOT,
    requiredMargin: Money.jpy('600'),
  });

const stubRule = (cmd: EntryCommand | null): EntryRule => ({
  shouldEntry: () => cmd ?? DoNothing.instance,
});

class FakeClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return new Date(this.fixed.getTime());
  }
}

const mockLogger = (): LogPort => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const mockEntryQueue = (): EntryQueuePort => ({
  start: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
  enqueue: vi.fn(),
  drain: vi.fn().mockResolvedValue(undefined),
  reservedMargin: vi.fn().mockReturnValue(Money.jpy('0')),
  drainAndWait: vi.fn().mockResolvedValue(undefined),
  dropAllAtShutdown: vi.fn().mockResolvedValue(undefined),
}) as unknown as EntryQueuePort;

const mockUiNotifier = (): UiNotifier => ({
  notifyEntryReady: vi.fn().mockResolvedValue(undefined),
  notifyEntryExpired: vi.fn().mockResolvedValue(undefined),
  notifyExitExecuted: vi.fn().mockResolvedValue(undefined),
}) as unknown as UiNotifier;

const mockBalancePort = (balance: Balance | Error): BalancePort => ({
  current: vi.fn().mockReturnValue(null),
  freshNow: balance instanceof Error
    ? vi.fn().mockRejectedValue(balance)
    : vi.fn().mockResolvedValue(balance),
});

const mockPositionRepository = (overrides: Partial<PositionRepository> = {}): PositionRepository => ({
  register: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  findById: vi.fn(),
  openPositions: vi.fn().mockResolvedValue(OpenPositions.empty()),
  findOpenByPairAndStrategy: vi.fn().mockResolvedValue(null),
  markClosed: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const makeSizing = (lotUnits: number): SizingResult =>
  SizingResult.of(Lot.of(lotUnits), Rate.of('150', PAIR, T0), MARGIN_RATE);

const mockSizingService = (
  result: SizingResult | Error,
): PositionSizingService => ({
  executeWithFresh: result instanceof Error
    ? vi.fn().mockRejectedValue(result)
    : vi.fn().mockResolvedValue(result),
} as unknown as PositionSizingService);

const stubPolicy = (allocation: LotAllocation): AllocationPolicy => ({
  decide: vi.fn().mockReturnValue(allocation),
});

const makeOpenPosition = (strategy: StrategyName, pair = PAIR): Position => {
  const command = EntryCommand.of({
    pair,
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
    entryPrice: Price.of('150.000'),
    executedAt: Timestamp.of(T0),
  });
  return Position.open(command, result);
};

const allocationFor = (entries: Array<[StrategyName, string]>): LotAllocation => {
  const map = new Map<StrategyName, Ratio>();
  for (const [s, r] of entries) map.set(s, Ratio.of(r));
  return LotAllocation.of(map);
};

const BALANCE = Balance.of(Money.jpy('1000000'));

describe('PositionManager', () => {
  let entryQueue: ReturnType<typeof mockEntryQueue>;
  let uiNotifier: ReturnType<typeof mockUiNotifier>;
  let logger: ReturnType<typeof mockLogger>;
  let clock: Clock;

  beforeEach(() => {
    entryQueue = mockEntryQueue();
    uiNotifier = mockUiNotifier();
    logger = mockLogger();
    clock = new FakeClock(T0);
  });

  describe('Detect 段', () => {
    it('シグナルなしなら freshNow も decide も呼ばず即 return', async () => {
      // Given
      const balancePort = mockBalancePort(BALANCE);
      const sizingService = mockSizingService(makeSizing(100));
      const policy = stubPolicy(LotAllocation.suppressed([]));
      const repo = mockPositionRepository();
      const mgr = new PositionManager(
        [stubRule(null)],
        policy,
        sizingService,
        entryQueue,
        repo,
        balancePort,
        uiNotifier,
        clock,

        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(balancePort.freshNow).not.toHaveBeenCalled();
      expect(policy.decide).not.toHaveBeenCalled();
      expect(sizingService.executeWithFresh).not.toHaveBeenCalled();
      expect(entryQueue.enqueue).not.toHaveBeenCalled();
    });

    it('1 戦略 fire で 1 件 enqueue される', async () => {
      // Given
      const cmd = makeCommand(StrategyName.SMA_CROSS);
      const sizingService = mockSizingService(makeSizing(100));
      const policy = stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']]));
      const mgr = new PositionManager(
        [stubRule(cmd)],
        policy,
        sizingService,
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,

        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(entryQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(uiNotifier.notifyEntryReady).toHaveBeenCalledTimes(1);
    });

    it('2 戦略 fire で 2 件 enqueue される', async () => {
      // Given
      const sma = makeCommand(StrategyName.SMA_CROSS);
      const rsi = makeCommand(StrategyName.RSI_REVERSAL);
      const policy = stubPolicy(
        allocationFor([
          [StrategyName.SMA_CROSS, '0.5'],
          [StrategyName.RSI_REVERSAL, '0.5'],
        ]),
      );
      const mgr = new PositionManager(
        [stubRule(sma), stubRule(rsi)],
        policy,
        mockSizingService(makeSizing(200)),
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,

        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(entryQueue.enqueue).toHaveBeenCalledTimes(2);
    });
  });

  describe('外部 I/O 失敗', () => {
    it('freshNow 失敗で warn + 即 return（sizing 呼ばれない）', async () => {
      // Given
      const sizingService = mockSizingService(makeSizing(100));
      const policy = stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']]));
      const mgr = new PositionManager(
        [stubRule(makeCommand(StrategyName.SMA_CROSS))],
        policy,
        sizingService,
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(new Error('balance API down')),
        uiNotifier,
        clock,

        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('balancePort.freshNow'),
        expect.any(Object),
      );
      expect(sizingService.executeWithFresh).not.toHaveBeenCalled();
      expect(entryQueue.enqueue).not.toHaveBeenCalled();
    });

    it('openPositions 失敗で warn + 即 return（sizing 呼ばれない）', async () => {
      // Given
      const repo = mockPositionRepository({
        openPositions: vi.fn().mockRejectedValue(new Error('DB connection lost')),
      });
      const sizingService = mockSizingService(makeSizing(100));
      const policy = stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']]));
      const mgr = new PositionManager(
        [stubRule(makeCommand(StrategyName.SMA_CROSS))],
        policy,
        sizingService,
        entryQueue,
        repo,
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,
        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('positionRepository.openPositions'),
        expect.any(Object),
      );
      expect(sizingService.executeWithFresh).not.toHaveBeenCalled();
      expect(entryQueue.enqueue).not.toHaveBeenCalled();
    });

    it('sizing 失敗で warn + return', async () => {
      // Given
      const policy = stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']]));
      const mgr = new PositionManager(
        [stubRule(makeCommand(StrategyName.SMA_CROSS))],
        policy,
        mockSizingService(new Error('rate not fresh')),
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,

        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('sizingService'),
        expect.any(Object),
      );
      expect(entryQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('AllocationPolicy 全抑制', () => {
    it('isFullySuppressed なら info + return（sizing も呼ばれない）', async () => {
      // Given
      const sizingService = mockSizingService(makeSizing(100));
      const policy = stubPolicy(LotAllocation.suppressed([StrategyName.SMA_CROSS]));
      const mgr = new PositionManager(
        [stubRule(makeCommand(StrategyName.SMA_CROSS))],
        policy,
        sizingService,
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,

        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('fully suppressed'),
        expect.any(Object),
      );
      expect(sizingService.executeWithFresh).not.toHaveBeenCalled();
      expect(entryQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('合計ロット上限', () => {
    // Note: 単一 Lot 上限を超える StrategyLots は実コード経路では作れない
    // （`PositionSizingService` の `Lot` 自体が 500_000 でクランプされ、`apply()` で配分すれば
    // 合計 ≤ baseLot ≤ 500_000 が保証される）。`isExceedingSingleLotLimit()` 判定は
    // 将来 baseLot 上限が変わった場合のセーフネット（policies.md 1.11）。
    // 判定ロジック自体の単体テストは TotalUnits.test.ts でカバー済み。
    // ここでは「上限ぴったりまでは drop されない」境界値テストだけ持つ。

    it('上限ぴったり 500_000 は drop されず enqueue される', async () => {
      // Given
      const policy = stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']]));
      const mgr = new PositionManager(
        [stubRule(makeCommand(StrategyName.SMA_CROSS))],
        policy,
        mockSizingService(makeSizing(500_000)),
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,

        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(entryQueue.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('重複ポジション抑制', () => {
    it('openPositions に既存がある戦略のみ skip し他は enqueue（in-memory 判定）', async () => {
      // Given: SMA_CROSS は既存保有、RSI_REVERSAL は新規
      const sma = makeCommand(StrategyName.SMA_CROSS);
      const rsi = makeCommand(StrategyName.RSI_REVERSAL);
      const existing = makeOpenPosition(StrategyName.SMA_CROSS);
      const repo = mockPositionRepository({
        openPositions: vi.fn().mockResolvedValue(OpenPositions.of([existing])),
      });
      const policy = stubPolicy(
        allocationFor([
          [StrategyName.SMA_CROSS, '0.5'],
          [StrategyName.RSI_REVERSAL, '0.5'],
        ]),
      );
      const mgr = new PositionManager(
        [stubRule(sma), stubRule(rsi)],
        policy,
        mockSizingService(makeSizing(200)),
        entryQueue,
        repo,
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,

        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(entryQueue.enqueue).toHaveBeenCalledTimes(1);
      const enqueued = vi.mocked(entryQueue.enqueue).mock.calls[0][0] as EntryCommand;
      expect(enqueued.strategyName).toBe('RSI_REVERSAL');
      expect(logger.info).toHaveBeenCalledWith(
        'duplicate entry suppressed (in-memory)',
        expect.objectContaining({ strategy: 'SMA_CROSS' }),
      );
    });

    it('in-memory が空でも DB 直前確認で既存があれば skip（二段防御の二次）', async () => {
      // Given: openPositions は空、findOpenByPairAndStrategy で SMA_CROSS が引っかかる
      const existing = makeOpenPosition(StrategyName.SMA_CROSS);
      const repo = mockPositionRepository({
        openPositions: vi.fn().mockResolvedValue(OpenPositions.empty()),
        findOpenByPairAndStrategy: vi.fn().mockImplementation(async (_p, s: StrategyName) =>
          s === 'SMA_CROSS' ? existing : null,
        ),
      });
      const policy = stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']]));
      const mgr = new PositionManager(
        [stubRule(makeCommand(StrategyName.SMA_CROSS))],
        policy,
        mockSizingService(makeSizing(100)),
        entryQueue,
        repo,
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,
        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then: in-memory チェックを通過したが DB 確認で skip
      expect(entryQueue.enqueue).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'duplicate entry suppressed (db pre-check)',
        expect.objectContaining({ strategy: 'SMA_CROSS' }),
      );
    });

    it('findOpenByPairAndStrategy 失敗時は当該戦略のみ skip (fail-safe)', async () => {
      // Given: DB が落ちて findOpenByPairAndStrategy が reject
      const repo = mockPositionRepository({
        openPositions: vi.fn().mockResolvedValue(OpenPositions.empty()),
        findOpenByPairAndStrategy: vi.fn().mockRejectedValue(new Error('DB down')),
      });
      const policy = stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']]));
      const mgr = new PositionManager(
        [stubRule(makeCommand(StrategyName.SMA_CROSS))],
        policy,
        mockSizingService(makeSizing(100)),
        entryQueue,
        repo,
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,
        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then: enqueue されず warn が出る
      expect(entryQueue.enqueue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('findOpenByPairAndStrategy'),
        expect.any(Object),
      );
    });
  });

  describe('EntryCommand 組み立て', () => {
    it('lot は StrategyLots / requiredMargin は再計算 / 他フィールドは base から流用', async () => {
      // Given
      const base = makeCommand(StrategyName.SMA_CROSS);
      const sizing = makeSizing(200);
      const policy = stubPolicy(
        allocationFor([
          [StrategyName.SMA_CROSS, '0.5'],
          [StrategyName.RSI_REVERSAL, '0.5'],
        ]),
      );
      const mgr = new PositionManager(
        [stubRule(base), stubRule(makeCommand(StrategyName.RSI_REVERSAL))],
        policy,
        mockSizingService(sizing),
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,

        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then: 1 件目の enqueue が SMA_CROSS で、lot=100（200*0.5）
      const enqueued = vi.mocked(entryQueue.enqueue).mock.calls[0][0] as EntryCommand;
      expect(enqueued.strategyName).toBe('SMA_CROSS');
      expect(enqueued.lot.toNumber()).toBe(100);
      expect(enqueued.buySell).toBe(base.buySell);
      expect(enqueued.reason.equals(base.reason)).toBe(true);
      expect(enqueued.entrySnapshot).toBe(base.entrySnapshot);
      // requiredMargin = rate(150) × lot(100) × marginRate(0.04) = 600
      expect(enqueued.requiredMargin.equals(Money.jpy('600'))).toBe(true);
    });
  });

  describe('notifyEntryReady 失敗時', () => {
    it('notify が throw しても enqueue は継続する', async () => {
      // Given
      const failingUiNotifier = {
        notifyEntryReady: vi.fn().mockRejectedValue(new Error('UI down')),
        notifyEntryExpired: vi.fn(),
        notifyExitExecuted: vi.fn(),
      } as unknown as UiNotifier;
      const policy = stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']]));
      const mgr = new PositionManager(
        [stubRule(makeCommand(StrategyName.SMA_CROSS))],
        policy,
        mockSizingService(makeSizing(100)),
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(BALANCE),
        failingUiNotifier,
        clock,

        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);
      // notifyEntryReady は fire-and-forget なので、reject の catch ハンドラを
      // 走らせるため microtask キューを 1 回 flush する
      await Promise.resolve();
      await Promise.resolve();

      // Then
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('notifyEntryReady'),
        expect.any(Object),
      );
      expect(entryQueue.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('clock 連携', () => {
    it('enqueue は clock.now() を submittedAt として渡す', async () => {
      // Given
      const policy = stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']]));
      const mgr = new PositionManager(
        [stubRule(makeCommand(StrategyName.SMA_CROSS))],
        policy,
        mockSizingService(makeSizing(100)),
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,

        logger,
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then
      const submittedAt = vi.mocked(entryQueue.enqueue).mock.calls[0][1] as Date;
      expect(submittedAt.getTime()).toBe(T0.getTime());
    });
  });

  describe('番人による新規エントリー抑止（#290 Step2）', () => {
    const blockingAdmission = (): EntryAdmissionPort => ({
      admitEntry: () => EntryAdmission.blocked('連続認証失敗'),
    });
    const permittingAdmission = (): EntryAdmissionPort => ({
      admitEntry: () => EntryAdmission.permitted(),
    });

    it('番人が抑止中なら detect も balance も呼ばず enqueue しない（何も始めない）', async () => {
      // Given: シグナルが出る構成だが、番人が抑止中
      const cmd = makeCommand(StrategyName.SMA_CROSS);
      const shouldEntry = vi.fn().mockReturnValue(cmd);
      const rule: EntryRule = { shouldEntry };
      const balancePort = mockBalancePort(BALANCE);
      const sizingService = mockSizingService(makeSizing(100));
      const policy = stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']]));
      const mgr = new PositionManager(
        [rule],
        policy,
        sizingService,
        entryQueue,
        mockPositionRepository(),
        balancePort,
        uiNotifier,
        clock,
        logger,
        NoopEntryDecisionObserver,
        blockingAdmission(),
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then: 関門で止まり、パイプラインは一切走らない
      expect(shouldEntry).not.toHaveBeenCalled();
      expect(balancePort.freshNow).not.toHaveBeenCalled();
      expect(policy.decide).not.toHaveBeenCalled();
      expect(entryQueue.enqueue).not.toHaveBeenCalled();
    });

    it('抑止に入った瞬間だけ理由付きログを出す（連発しない）', async () => {
      // Given: 番人が抑止中
      const mgr = new PositionManager(
        [stubRule(makeCommand(StrategyName.SMA_CROSS))],
        stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']])),
        mockSizingService(makeSizing(100)),
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,
        logger,
        NoopEntryDecisionObserver,
        blockingAdmission(),
      );

      // When: 2 サイクル連続で抑止される
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then: ログは抑止に入った 1 回だけ。理由ラベルが載る
      const blockLogs = vi
        .mocked(logger.info)
        .mock.calls.filter((c) => String(c[0]).includes('番人が抑止中'));
      expect(blockLogs).toHaveLength(1);
      expect(blockLogs[0][1]).toMatchObject({ reason: '連続認証失敗' });
    });

    it('番人が許可中なら通常どおり enqueue される', async () => {
      // Given: 番人が許可
      const cmd = makeCommand(StrategyName.SMA_CROSS);
      const sizingService = mockSizingService(makeSizing(100));
      const policy = stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']]));
      const mgr = new PositionManager(
        [stubRule(cmd)],
        policy,
        sizingService,
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,
        logger,
        NoopEntryDecisionObserver,
        permittingAdmission(),
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then
      expect(entryQueue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('抑止中でも観測（decisionObserver）は流す', async () => {
      // Given: 抑止中だが観測器を注入
      const observer = { observe: vi.fn() };
      const mgr = new PositionManager(
        [stubRule(makeCommand(StrategyName.SMA_CROSS))],
        stubPolicy(allocationFor([[StrategyName.SMA_CROSS, '1']])),
        mockSizingService(makeSizing(100)),
        entryQueue,
        mockPositionRepository(),
        mockBalancePort(BALANCE),
        uiNotifier,
        clock,
        logger,
        observer,
        blockingAdmission(),
      );

      // When
      await mgr.handleSignals(PAIR, DUMMY_MARKET_SNAPSHOT);

      // Then: 観測は流れる（運用画面で経過が見える）が、enqueue はしない
      expect(observer.observe).toHaveBeenCalledTimes(1);
      expect(entryQueue.enqueue).not.toHaveBeenCalled();
    });
  });
});
