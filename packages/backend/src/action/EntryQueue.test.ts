import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EntryQueue } from './EntryQueue.js';
import type { EntryExecutor } from './EntryExecutor.js';
import { EntryCommand } from '../domain/command/EntryCommand.js';
import { EntryReason } from '../domain/command/EntryReason.js';
import { CurrencyPair } from '../domain/market/CurrencyPair.js';
import { BuySell } from '../domain/market/BuySell.js';
import { Lot } from '../domain/position/Lot.js';
import { ConvictionScore } from '../domain/market/ConvictionScore.js';
import { StrategyName } from '../domain/rule/StrategyName.js';
import { EntrySnapshot } from '../domain/market/snapshot/EntrySnapshot.js';
import { Money } from '../domain/Money.js';
import type { Clock } from '../port/Clock.js';
import type { LogPort } from '../domain/port/LogPort.js';
import type { UiNotifier } from '../port/UiNotifier.js';

// ── テスト用 FakeClock（policies.md 3.7 節） ─────────────────

class FakeClock implements Clock {
  private current: Date;
  constructor(initial: Date) {
    this.current = new Date(initial.getTime());
  }
  now(): Date {
    // 防御的コピー
    return new Date(this.current.getTime());
  }
  advance(millis: number): void {
    this.current = new Date(this.current.getTime() + millis);
  }
}

// ── テストヘルパー ────────────────────────────────────────────

const DUMMY_SNAPSHOT = EntrySnapshot.of({
  convictionScore: '0.5',
  entryHour: 12,
  entryDayOfWeek: 3,
});

const makeCommand = (overrides: {
  requiredMargin?: Money;
  reason?: string;
  strategyName?: StrategyName;
} = {}): EntryCommand =>
  EntryCommand.of({
    pair: CurrencyPair('USD_JPY'),
    buySell: BuySell.BUY,
    lot: Lot.of(100),
    reason: EntryReason.of(overrides.reason ?? 'SMAゴールデンクロス'),
    convictionScore: ConvictionScore.of('0.8'),
    strategyName: overrides.strategyName ?? StrategyName.SMA_CROSS,
    entrySnapshot: DUMMY_SNAPSHOT,
    requiredMargin: overrides.requiredMargin ?? Money.jpy('600'),
  });

const mockLogger = (): LogPort => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const mockUiNotifier = (): UiNotifier => ({
  notifyEntryReady: vi.fn().mockResolvedValue(undefined),
  notifyEntryExpired: vi.fn().mockResolvedValue(undefined),
  notifyExitExecuted: vi.fn().mockResolvedValue(undefined),
  notifyTradingHalted: vi.fn().mockResolvedValue(undefined),
});

const mockEntryExecution = (): EntryExecutor => ({
  openPosition: vi.fn().mockResolvedValue(undefined),
});

const T0 = new Date('2026-04-22T12:00:00.000Z');

// ── テスト ────────────────────────────────────────────────────

describe('EntryQueue', () => {
  let clock: FakeClock;
  let logger: LogPort;
  let uiNotifier: UiNotifier;
  let entryExecution: EntryExecutor;
  let queue: EntryQueue;

  beforeEach(() => {
    clock = new FakeClock(T0);
    logger = mockLogger();
    uiNotifier = mockUiNotifier();
    entryExecution = mockEntryExecution();
    queue = new EntryQueue(entryExecution, clock, logger, uiNotifier, {
      ttlMs: 3000,
      drainIntervalMs: 100,
    });
  });

  afterEach(async () => {
    // タイマー残留を防ぐ
    await queue.stop();
  });

  // ── 3.10.1 TTL 判定 ───────────────────────────────────────

  describe('TTL 判定（FakeClock）', () => {
    it('T=0 で enqueue、T=2.9s で drain → openPosition が呼ばれる', async () => {
      // Given: T=0 で enqueue
      const cmd = makeCommand();
      queue.enqueue(cmd, clock.now());

      // When: T=2.9s に進めて drain
      clock.advance(2900);
      await queue.drain();

      // Then: 発注される
      expect(entryExecution.openPosition).toHaveBeenCalledWith(cmd);
      expect(entryExecution.openPosition).toHaveBeenCalledTimes(1);
      expect(uiNotifier.notifyEntryExpired).not.toHaveBeenCalled();
    });

    it('T=0 で enqueue、T=3.1s で drain → drop + warn ログ + uiNotifier.notifyEntryExpired', async () => {
      // Given: T=0 で enqueue
      const cmd = makeCommand();
      queue.enqueue(cmd, clock.now());

      // When: T=3.1s に進めて drain
      clock.advance(3100);
      await queue.drain();

      // Then: 発注されず、drop ログと UI 通知が走る
      expect(entryExecution.openPosition).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'signal dropped due to TTL',
        expect.objectContaining({
          age: 3100,
          ttl: 3000,
          strategy: cmd.strategyName,
          pair: cmd.pair.toString(),
        }),
      );
      expect(uiNotifier.notifyEntryExpired).toHaveBeenCalledWith(cmd);
    });

    it('age == ttlMs ちょうどは drop されない（境界: > のみ drop）', async () => {
      const cmd = makeCommand();
      queue.enqueue(cmd, clock.now());
      clock.advance(3000);
      await queue.drain();
      expect(entryExecution.openPosition).toHaveBeenCalledWith(cmd);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // ── 3.10.2 FIFO 順序 ──────────────────────────────────────

  describe('FIFO 順序', () => {
    it('複数 enqueue → drain で先入れ先出しされる', async () => {
      const cmdA = makeCommand({ reason: 'A' });
      const cmdB = makeCommand({ reason: 'B' });
      const cmdC = makeCommand({ reason: 'C' });

      queue.enqueue(cmdA, clock.now());
      clock.advance(10);
      queue.enqueue(cmdB, clock.now());
      clock.advance(10);
      queue.enqueue(cmdC, clock.now());

      await queue.drain();
      await queue.drain();
      await queue.drain();

      expect(entryExecution.openPosition).toHaveBeenNthCalledWith(1, cmdA);
      expect(entryExecution.openPosition).toHaveBeenNthCalledWith(2, cmdB);
      expect(entryExecution.openPosition).toHaveBeenNthCalledWith(3, cmdC);
    });

    it('同一時刻で enqueue されても push 順が維持される', async () => {
      const cmdA = makeCommand({ reason: 'A' });
      const cmdB = makeCommand({ reason: 'B' });
      const same = clock.now();

      queue.enqueue(cmdA, same);
      queue.enqueue(cmdB, same);

      await queue.drain();
      await queue.drain();

      expect(entryExecution.openPosition).toHaveBeenNthCalledWith(1, cmdA);
      expect(entryExecution.openPosition).toHaveBeenNthCalledWith(2, cmdB);
    });
  });

  // ── 3.10.3 排他制御（C9） ────────────────────────────────

  describe('排他 drain（C9）', () => {
    it('drain 中に並列 drain を呼んでも 2 回処理されない（同一の進行中 drain を待つ）', async () => {
      // Given: openPosition が完了するまでブロックする promise
      let release!: () => void;
      const blocker = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(entryExecution.openPosition).mockImplementation(async () => {
        await blocker;
      });

      const cmdA = makeCommand({ reason: 'A' });
      const cmdB = makeCommand({ reason: 'B' });
      queue.enqueue(cmdA, clock.now());
      queue.enqueue(cmdB, clock.now());

      // When: 並列に 2 回 drain を起動（最初の openPosition は未完）
      const first = queue.drain();
      const second = queue.drain();

      // この時点で 2 本目の処理は走っていない（openPosition は 1 回しか呼ばれていない）
      expect(entryExecution.openPosition).toHaveBeenCalledTimes(1);
      expect(entryExecution.openPosition).toHaveBeenCalledWith(cmdA);

      // 1 本目を完了させる
      release();
      await Promise.all([first, second]);

      // 2 本目は進行中 drain の完了を待つだけで、第 2 件目を取り出さない
      // （cmdB はキューに残っている。次の drain 呼び出しで処理される）
      expect(entryExecution.openPosition).toHaveBeenCalledTimes(1);
      expect(queue.reservedMargin().equals(cmdB.requiredMargin)).toBe(true);
    });

    it('drain 中の stop() は in-flight の openPosition を待ってから dropAllAtShutdown する', async () => {
      // Given: openPosition が完了するまでブロックする promise
      let release!: () => void;
      const blocker = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(entryExecution.openPosition).mockImplementation(async () => {
        await blocker;
      });

      const cmdA = makeCommand({ reason: 'A' });
      const cmdB = makeCommand({ reason: 'B' });
      queue.enqueue(cmdA, clock.now());
      queue.enqueue(cmdB, clock.now());

      // When: drain 起動 → stop() を即時呼ぶ（cmdA の openPosition は未完）
      const draining = queue.drain();
      const stopping = queue.stop();

      // stop() は in-flight 完了待ちで pending のはず
      // openPosition は呼ばれているが、まだ完了していない
      expect(entryExecution.openPosition).toHaveBeenCalledTimes(1);
      expect(entryExecution.openPosition).toHaveBeenCalledWith(cmdA);
      // 残留 cmdB はまだ drop されていない
      expect(uiNotifier.notifyEntryExpired).not.toHaveBeenCalled();

      // openPosition を完了させる
      release();
      await draining;
      await stopping;

      // in-flight の cmdA は発注成功扱い（info）
      expect(logger.info).toHaveBeenCalledWith(
        'entry placed',
        expect.objectContaining({ strategy: cmdA.strategyName }),
      );
      // 残留分 cmdB は dropAllAtShutdown で drop される（notifyEntryExpired が cmdB に対して呼ばれる）
      expect(uiNotifier.notifyEntryExpired).toHaveBeenCalledWith(cmdB);
      // キューは空
      expect(queue.reservedMargin().isZero()).toBe(true);
    });

    it('drainAndWait は進行中 drain がある場合その完了を待ってから次の drain に進む（ビジーループ回避）', async () => {
      // Given: openPosition が完了するまでブロックする promise
      let release!: () => void;
      const blocker = new Promise<void>((resolve) => {
        release = resolve;
      });
      let callCount = 0;
      vi.mocked(entryExecution.openPosition).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          await blocker;
        }
        // 2 件目以降は即返す
      });

      const cmdA = makeCommand({ reason: 'A' });
      const cmdB = makeCommand({ reason: 'B' });
      queue.enqueue(cmdA, clock.now());
      queue.enqueue(cmdB, clock.now());

      // When: drain 起動 → drainAndWait を呼ぶ（drain が in-flight の状態）
      const draining = queue.drain();
      const waiting = queue.drainAndWait();

      // この時点で openPosition は 1 件目のみ呼ばれており、drainAndWait はビジーループせず待機している
      expect(entryExecution.openPosition).toHaveBeenCalledTimes(1);

      // 1 件目を完了させる → drainAndWait が 2 件目を処理して完了するはず
      release();
      await draining;
      await waiting;

      expect(entryExecution.openPosition).toHaveBeenCalledTimes(2);
      expect(entryExecution.openPosition).toHaveBeenNthCalledWith(1, cmdA);
      expect(entryExecution.openPosition).toHaveBeenNthCalledWith(2, cmdB);
      expect(queue.reservedMargin().isZero()).toBe(true);
    });
  });

  // ── 3.10.4 stop / lifecycle ─────────────────────────────

  describe('stop() 後の enqueue', () => {
    it('stop() 後の enqueue は拒否され、info ログが出る', async () => {
      await queue.stop();

      const cmd = makeCommand();
      queue.enqueue(cmd, clock.now());

      expect(logger.info).toHaveBeenCalledWith('enqueue ignored after stop');
      expect(queue.reservedMargin().isZero()).toBe(true);
    });
  });

  describe('dropAllAtShutdown', () => {
    it('残留分が全 drop され、各 drop で notifyEntryExpired が呼ばれる', async () => {
      const cmdA = makeCommand({ reason: 'A' });
      const cmdB = makeCommand({ reason: 'B' });
      queue.enqueue(cmdA, clock.now());
      queue.enqueue(cmdB, clock.now());

      await queue.dropAllAtShutdown();

      // 発注はされない
      expect(entryExecution.openPosition).not.toHaveBeenCalled();
      // 2 件分の drop ログ
      expect(logger.info).toHaveBeenCalledWith(
        'entry dropped at shutdown',
        expect.objectContaining({ strategy: cmdA.strategyName, pair: cmdA.pair.toString() }),
      );
      // 各 drop で UI 通知
      expect(uiNotifier.notifyEntryExpired).toHaveBeenCalledTimes(2);
      expect(uiNotifier.notifyEntryExpired).toHaveBeenCalledWith(cmdA);
      expect(uiNotifier.notifyEntryExpired).toHaveBeenCalledWith(cmdB);
      // キューは空
      expect(queue.reservedMargin().isZero()).toBe(true);
    });

    it('stop() 経由でも残留分が全 drop される', async () => {
      const cmd = makeCommand();
      queue.enqueue(cmd, clock.now());

      await queue.stop();

      expect(entryExecution.openPosition).not.toHaveBeenCalled();
      expect(uiNotifier.notifyEntryExpired).toHaveBeenCalledWith(cmd);
    });

    it('notifyEntryExpired が一度 throw しても残りのエントリーが全部 drop される', async () => {
      const cmdA = makeCommand({ reason: 'A' });
      const cmdB = makeCommand({ reason: 'B' });
      const cmdC = makeCommand({ reason: 'C' });
      queue.enqueue(cmdA, clock.now());
      queue.enqueue(cmdB, clock.now());
      queue.enqueue(cmdC, clock.now());

      // 1 件目（A）の通知だけ throw、以降は成功
      vi.mocked(uiNotifier.notifyEntryExpired)
        .mockRejectedValueOnce(new Error('UI notify failed'))
        .mockResolvedValue(undefined);

      await queue.dropAllAtShutdown();

      // 3 件全部 notify が呼ばれていること（途中で止まらない）
      expect(uiNotifier.notifyEntryExpired).toHaveBeenCalledTimes(3);
      expect(uiNotifier.notifyEntryExpired).toHaveBeenNthCalledWith(1, cmdA);
      expect(uiNotifier.notifyEntryExpired).toHaveBeenNthCalledWith(2, cmdB);
      expect(uiNotifier.notifyEntryExpired).toHaveBeenNthCalledWith(3, cmdC);
      // 失敗した通知は error ログに出る
      expect(logger.error).toHaveBeenCalledWith(
        'notifyEntryExpired failed at shutdown drop',
        expect.objectContaining({
          error: expect.stringContaining('UI notify failed'),
          strategy: cmdA.strategyName,
          pair: cmdA.pair.toString(),
        }),
      );
      // 発注はされない / キューは空
      expect(entryExecution.openPosition).not.toHaveBeenCalled();
      expect(queue.reservedMargin().isZero()).toBe(true);
    });
  });

  // ── 3.10.6 reservedMargin ───────────────────────────────

  describe('reservedMargin()', () => {
    it('空キューでは Money.jpy("0") を返す', () => {
      expect(queue.reservedMargin().equals(Money.jpy('0'))).toBe(true);
    });

    it('1 件 enqueue 後は その requiredMargin と一致', () => {
      const cmd = makeCommand({ requiredMargin: Money.jpy('1234') });
      queue.enqueue(cmd, clock.now());
      expect(queue.reservedMargin().equals(Money.jpy('1234'))).toBe(true);
    });

    it('複数 enqueue 後は各 requiredMargin の和と一致する', () => {
      queue.enqueue(makeCommand({ requiredMargin: Money.jpy('100') }), clock.now());
      queue.enqueue(makeCommand({ requiredMargin: Money.jpy('250') }), clock.now());
      queue.enqueue(makeCommand({ requiredMargin: Money.jpy('700') }), clock.now());
      expect(queue.reservedMargin().equals(Money.jpy('1050'))).toBe(true);
    });

    it('drain で消化された分は reservedMargin に含まれない', async () => {
      queue.enqueue(makeCommand({ requiredMargin: Money.jpy('100') }), clock.now());
      queue.enqueue(makeCommand({ requiredMargin: Money.jpy('200') }), clock.now());
      await queue.drain();
      expect(queue.reservedMargin().equals(Money.jpy('200'))).toBe(true);
    });
  });

  // ── 3.10.5 失敗時の挙動 ──────────────────────────────────

  describe('API 失敗時の drop', () => {
    it('openPosition が throw → 再投入されず drop + warn + notifyEntryExpired', async () => {
      const cmd = makeCommand();
      vi.mocked(entryExecution.openPosition).mockRejectedValueOnce(new Error('API Error'));
      queue.enqueue(cmd, clock.now());

      await queue.drain();

      expect(logger.warn).toHaveBeenCalledWith(
        'placeEntry failed - signal dropped',
        expect.objectContaining({
          error: expect.stringContaining('API Error'),
          strategy: cmd.strategyName,
        }),
      );
      expect(uiNotifier.notifyEntryExpired).toHaveBeenCalledWith(cmd);
      // キューに再投入されていない
      expect(queue.reservedMargin().isZero()).toBe(true);
    });

    it('発注成功時は info ログが出る', async () => {
      const cmd = makeCommand();
      queue.enqueue(cmd, clock.now());

      await queue.drain();

      expect(logger.info).toHaveBeenCalledWith(
        'entry placed',
        expect.objectContaining({
          strategy: cmd.strategyName,
          pair: cmd.pair.toString(),
        }),
      );
    });
  });

  // ── drainAndWait ─────────────────────────────────────────

  describe('drainAndWait()', () => {
    it('全件処理されるまで drain を繰り返す', async () => {
      const cmds = [
        makeCommand({ reason: 'A' }),
        makeCommand({ reason: 'B' }),
        makeCommand({ reason: 'C' }),
      ];
      cmds.forEach((c) => queue.enqueue(c, clock.now()));

      await queue.drainAndWait();

      expect(entryExecution.openPosition).toHaveBeenCalledTimes(3);
      expect(queue.reservedMargin().isZero()).toBe(true);
    });
  });

  // ── start() 冪等性 ──────────────────────────────────────

  describe('start() 冪等性', () => {
    it('start() を 2 回呼んでも setInterval は二重起動しない', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      queue.start();
      queue.start();

      // setInterval は 1 回しか呼ばれない
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      setIntervalSpy.mockRestore();
    });

    it('start() で setInterval が登録され、間隔 drainIntervalMs で呼ばれる', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      queue.start();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 100);
      setIntervalSpy.mockRestore();
    });
  });
});
