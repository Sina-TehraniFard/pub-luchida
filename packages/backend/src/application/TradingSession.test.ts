import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TradingSession } from './TradingSession.js';
import { ExitDispatchResult } from '../domain/exit/ExitDispatchResult.js';
import { CurrencyPair } from '../domain/market/CurrencyPair.js';
import { Price } from '../domain/market/Price.js';
import { PositionId } from '../domain/position/PositionId.js';
import { StrategyName } from '../domain/rule/StrategyName.js';
import { Money } from '../domain/Money.js';
import { TimeFrame } from '../domain/market/TimeFrame.js';
import { Logger } from '../infrastructure/logging/Logger.js';
import type { EntryQueuePort } from '../port/EntryQueuePort.js';
import type { CandleHistoryPort } from '../port/CandleHistoryPort.js';
import type { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';
import type { MarketDataStreamPort } from '../port/MarketDataStreamPort.js';
import type { PositionManager } from './PositionManager.js';
import type { ExitDispatcher } from './ExitDispatcher.js';
import type { PositionExtremesUpdater } from './PositionExtremesUpdater.js';
import type { UiNotifier } from '../port/UiNotifier.js';
import { ExitFailureCircuitBreaker } from '../domain/guard/ExitFailureCircuitBreaker.js';
import { ExitFailureThreshold } from '../domain/guard/ExitFailureThreshold.js';
import { Tick } from '../domain/market/tick/Tick.js';
import { TickTimestamp } from '../domain/market/tick/TickTimestamp.js';

const PAIR = CurrencyPair('USD_JPY');

const fakeTick = Tick.of(
    Price.of('150.001'),
    Price.of('149.999'),
    TickTimestamp.of(new Date('2024-01-15T10:00:00.000Z')),
);
const fakeSnapshot = { tick: fakeTick, pair: PAIR } as MarketSnapshot;

const makeSnapshot = (label: string): MarketSnapshot =>
    ({ tick: fakeTick, pair: PAIR, _label: label }) as unknown as MarketSnapshot;

// ── モック ──────────────────────────────────────────────────

const mockEntryQueue = (): EntryQueuePort => ({
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn(),
    drain: vi.fn().mockResolvedValue(undefined),
    reservedMargin: vi.fn().mockReturnValue(Money.jpy('0')),
    drainAndWait: vi.fn().mockResolvedValue(undefined),
    dropAllAtShutdown: vi.fn().mockResolvedValue(undefined),
}) as unknown as EntryQueuePort;

const mockCandleHistoryPort = (): CandleHistoryPort => ({
    fetchRecent: vi.fn().mockResolvedValue([]),
});

const mockMarketDataStream = (): MarketDataStreamPort => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
});

const mockTimeFrameBook = () => ({
    warmUp: vi.fn(),
    onTick: vi.fn(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

const mockPositionManager = (): PositionManager => ({
    handleSignals: vi.fn().mockResolvedValue(undefined),
}) as unknown as PositionManager;

const mockExitDispatcher = (
    result: ExitDispatchResult = ExitDispatchResult.empty(),
): ExitDispatcher => ({
    dispatch: vi.fn().mockResolvedValue(result),
}) as unknown as ExitDispatcher;

const mockPositionExtremesUpdater = (): PositionExtremesUpdater => ({
    update: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(),
    remove: vi.fn(),
}) as unknown as PositionExtremesUpdater;

const mockUiNotifier = (): UiNotifier => ({
    notifyEntryReady: vi.fn().mockResolvedValue(undefined),
    notifyEntryExpired: vi.fn().mockResolvedValue(undefined),
    notifyExitExecuted: vi.fn().mockResolvedValue(undefined),
    notifyTradingHalted: vi.fn().mockResolvedValue(undefined),
});

// 既定は素通し（閾値 99）。kill-switch テストでは個別に閾値 1 の breaker を作る
const makeBreaker = (threshold = 99): ExitFailureCircuitBreaker =>
    new ExitFailureCircuitBreaker(ExitFailureThreshold.of(threshold), 0);

// ── テスト ──────────────────────────────────────────────────

describe('TradingSession', () => {
    let positionManager: PositionManager;
    let exitDispatcher: ExitDispatcher;
    let extremesUpdater: PositionExtremesUpdater;
    let entryQueue: EntryQueuePort;
    let candleHistoryPort: CandleHistoryPort;
    let marketDataStream: MarketDataStreamPort;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let timeFrameBook: any;
    let uiNotifier: UiNotifier;
    let session: TradingSession;

    beforeEach(() => {
        positionManager = mockPositionManager();
        exitDispatcher = mockExitDispatcher();
        extremesUpdater = mockPositionExtremesUpdater();
        entryQueue = mockEntryQueue();
        candleHistoryPort = mockCandleHistoryPort();
        marketDataStream = mockMarketDataStream();
        timeFrameBook = mockTimeFrameBook();
        uiNotifier = mockUiNotifier();

        session = new TradingSession(
            PAIR,
            positionManager,
            exitDispatcher,
            extremesUpdater,
            entryQueue,
            timeFrameBook,
            marketDataStream,
            candleHistoryPort,
            makeBreaker(),
            uiNotifier,
        );
    });

    describe('start()', () => {
        it('各時間足の過去データを取得して warmUp を呼ぶ', async () => {
            // Given
            // When
            await session.start();
            // Then: 4 つの時間足分 fetchRecent が呼ばれる
            expect(candleHistoryPort.fetchRecent).toHaveBeenCalledTimes(4);
            expect(candleHistoryPort.fetchRecent).toHaveBeenCalledWith(TimeFrame.ONE_MINUTE, 200);
            expect(candleHistoryPort.fetchRecent).toHaveBeenCalledWith(TimeFrame.FIFTEEN_MINUTE, 200);
            expect(candleHistoryPort.fetchRecent).toHaveBeenCalledWith(TimeFrame.ONE_HOUR, 200);
            expect(candleHistoryPort.fetchRecent).toHaveBeenCalledWith(TimeFrame.ONE_DAY, 200);
        });

        it('MarketDataStream.start が呼ばれる', async () => {
            await session.start();
            expect(marketDataStream.start).toHaveBeenCalledTimes(1);
        });

        it('EntryQueue.start が呼ばれる（他の初期化後に）', async () => {
            const calls: string[] = [];
            vi.mocked(marketDataStream.start).mockImplementation(async () => {
                calls.push('marketDataStream.start');
            });
            vi.mocked(entryQueue.start).mockImplementation(() => {
                calls.push('entryQueue.start');
            });

            await session.start();

            expect(entryQueue.start).toHaveBeenCalledTimes(1);
            expect(calls.indexOf('marketDataStream.start')).toBeLessThan(calls.indexOf('entryQueue.start'));
        });

        it('marketDataStream.start が throw した場合、entryQueue.start は呼ばれない（孤児タイマー防止）', async () => {
            vi.mocked(marketDataStream.start).mockRejectedValue(new Error('stream init failed'));

            await expect(session.start()).rejects.toThrow('stream init failed');
            expect(entryQueue.start).not.toHaveBeenCalled();
        });

        it('candleHistoryPort.fetchRecent が throw した場合、stream/queue とも開始しない', async () => {
            vi.mocked(candleHistoryPort.fetchRecent).mockRejectedValue(new Error('fetch failed'));

            await expect(session.start()).rejects.toThrow('fetch failed');
            expect(marketDataStream.start).not.toHaveBeenCalled();
            expect(entryQueue.start).not.toHaveBeenCalled();
        });
    });

    describe('stop()', () => {
        it('MarketDataStream.stop と EntryQueue.stop が呼ばれる', async () => {
            await session.stop();
            expect(marketDataStream.stop).toHaveBeenCalledTimes(1);
            expect(entryQueue.stop).toHaveBeenCalledTimes(1);
        });

        it('2 回呼び出しても 1 度しか stop しない（冪等）', async () => {
            await session.stop();
            await session.stop();
            expect(marketDataStream.stop).toHaveBeenCalledTimes(1);
            expect(entryQueue.stop).toHaveBeenCalledTimes(1);
        });

        it('marketDataStream.stop が throw しても entryQueue.stop は呼ばれる', async () => {
            vi.mocked(marketDataStream.stop).mockRejectedValue(new Error('stream stop failed'));

            await expect(session.stop()).rejects.toThrow('stream stop failed');
            expect(marketDataStream.stop).toHaveBeenCalledTimes(1);
            expect(entryQueue.stop).toHaveBeenCalledTimes(1);
        });

        it('boundaryWatchdog.stop が throw しても後続停止は継続する', async () => {
            // Given: stop で throw する壁時計を注入
            const watchdog = {
                start: vi.fn(),
                stop: vi.fn(() => {
                    throw new Error('watchdog stop failed');
                }),
            };
            const s = new TradingSession(
                PAIR,
                positionManager,
                exitDispatcher,
                extremesUpdater,
                entryQueue,
                timeFrameBook,
                marketDataStream,
                candleHistoryPort,
                makeBreaker(),
                uiNotifier,
                watchdog,
            );

            // When / Then: 最初のエラーは伝播するが、後続の停止は全て試みられる
            await expect(s.stop()).rejects.toThrow('watchdog stop failed');
            expect(watchdog.stop).toHaveBeenCalledTimes(1);
            expect(marketDataStream.stop).toHaveBeenCalledTimes(1);
            expect(entryQueue.stop).toHaveBeenCalledTimes(1);
        });
    });

    describe('onMarketData()', () => {
        it('extremesUpdater.update → exitDispatcher.dispatch → positionManager.handleSignals の順で呼ぶ', async () => {
            const calls: string[] = [];
            vi.mocked(extremesUpdater.update).mockImplementation(async () => {
                calls.push('extremesUpdater.update');
            });
            vi.mocked(exitDispatcher.dispatch).mockImplementation(async () => {
                calls.push('exitDispatcher.dispatch');
                return ExitDispatchResult.empty();
            });
            vi.mocked(positionManager.handleSignals).mockImplementation(async () => {
                calls.push('positionManager.handleSignals');
            });

            await session.onMarketData(fakeSnapshot);

            expect(calls).toEqual([
                'extremesUpdater.update',
                'exitDispatcher.dispatch',
                'positionManager.handleSignals',
            ]);
        });

        it('pair-bound: snapshot.pair が session の pair と不一致なら何も呼ばない', async () => {
            const otherPairSnapshot = {
                tick: fakeTick,
                pair: CurrencyPair('EUR_JPY'),
            } as MarketSnapshot;

            await session.onMarketData(otherPairSnapshot);

            expect(extremesUpdater.update).not.toHaveBeenCalled();
            expect(exitDispatcher.dispatch).not.toHaveBeenCalled();
            expect(positionManager.handleSignals).not.toHaveBeenCalled();
        });

        it('stop() 後の onMarketData では何も呼ばない（Entry/Exit 一括ガード）', async () => {
            await session.stop();

            await session.onMarketData(fakeSnapshot);

            expect(extremesUpdater.update).not.toHaveBeenCalled();
            expect(exitDispatcher.dispatch).not.toHaveBeenCalled();
            expect(positionManager.handleSignals).not.toHaveBeenCalled();
        });

        it('processing 中の再入は pendingSnapshot に保持され、処理完了後に最新の snapshot が再評価される（coalesce）', async () => {
            // Given: 1 回目の dispatch を遅延させ、その間に 2 回目を呼ぶ
            const snap1 = makeSnapshot('snap1');
            const snap2 = makeSnapshot('snap2');
            let resolveFirst: () => void = () => {};
            const firstPromise = new Promise<void>((resolve) => {
                resolveFirst = resolve;
            });
            vi.mocked(exitDispatcher.dispatch).mockImplementationOnce(async () => {
                await firstPromise;
                return ExitDispatchResult.empty();
            });

            // When: 1 回目を開始（解決させない）→ 2 回目を呼ぶ（pendingSnapshot に保持）
            const first = session.onMarketData(snap1);
            const second = session.onMarketData(snap2);

            await second;
            expect(exitDispatcher.dispatch).toHaveBeenCalledTimes(1);
            expect(exitDispatcher.dispatch).toHaveBeenCalledWith(PAIR, snap1);

            // 1 回目を解決 → coalesce で pendingSnapshot を処理
            resolveFirst();
            await first;

            // Then: 2 回目の dispatch は最新 snapshot（snap2）で呼ばれる
            expect(exitDispatcher.dispatch).toHaveBeenCalledTimes(2);
            expect(exitDispatcher.dispatch).toHaveBeenLastCalledWith(PAIR, snap2);
            expect(extremesUpdater.update).toHaveBeenLastCalledWith(PAIR, snap2);
        });

        it('processing 中に複数回再入しても pending は最後の 1 件のみ保持（中間 tick は drop）', async () => {
            // Given
            const snap1 = makeSnapshot('snap1');
            const snap2 = makeSnapshot('snap2');
            const snap3 = makeSnapshot('snap3');
            const snap4 = makeSnapshot('snap4');
            let resolveFirst: () => void = () => {};
            const firstPromise = new Promise<void>((resolve) => {
                resolveFirst = resolve;
            });
            vi.mocked(exitDispatcher.dispatch).mockImplementationOnce(async () => {
                await firstPromise;
                return ExitDispatchResult.empty();
            });

            // When: 1 回目を開始 → 2-4 回目を連続で呼ぶ（snap2/3 は drop、snap4 だけが pending）
            const first = session.onMarketData(snap1);
            await session.onMarketData(snap2);
            await session.onMarketData(snap3);
            await session.onMarketData(snap4);

            resolveFirst();
            await first;

            // Then: 1 回目 + pending 1 件 = 計 2 回 dispatch、最後は snap4
            expect(exitDispatcher.dispatch).toHaveBeenCalledTimes(2);
            expect(exitDispatcher.dispatch).toHaveBeenLastCalledWith(PAIR, snap4);
        });

        it('processing 解放後の onMarketData は再び評価される', async () => {
            // Given
            await session.onMarketData(fakeSnapshot);

            // When: 2 回目
            await session.onMarketData(fakeSnapshot);

            // Then: 2 回ともフローが回る
            expect(extremesUpdater.update).toHaveBeenCalledTimes(2);
            expect(exitDispatcher.dispatch).toHaveBeenCalledTimes(2);
            expect(positionManager.handleSignals).toHaveBeenCalledTimes(2);
        });

        it('先頭処理が throw しても pendingSnapshot を drain してから元の例外を再 throw', async () => {
            // Given: snap1 で dispatch が throw、snap2 が pending
            const snap1 = makeSnapshot('snap1');
            const snap2 = makeSnapshot('snap2');
            const primaryError = new Error('dispatch failed');
            let releaseFirst: () => void = () => {};
            const gate = new Promise<void>((resolve) => {
                releaseFirst = resolve;
            });
            vi.mocked(exitDispatcher.dispatch)
                .mockImplementationOnce(async () => {
                    await gate;
                    throw primaryError;
                })
                .mockResolvedValue(ExitDispatchResult.empty());

            // When: snap1 を開始 → snap2 を pending → snap1 を throw 解決
            const first = session.onMarketData(snap1);
            await session.onMarketData(snap2);
            releaseFirst();

            // Then: 元の例外が rethrow される
            await expect(first).rejects.toBe(primaryError);

            // pending の snap2 は drain されている（dispatch 2 回目）
            expect(exitDispatcher.dispatch).toHaveBeenCalledTimes(2);
            expect(exitDispatcher.dispatch).toHaveBeenLastCalledWith(PAIR, snap2);
            // 後始末で processing は false に戻り、pending は null
            // → 次の onMarketData は通常通り処理される
            await session.onMarketData(snap1);
            expect(exitDispatcher.dispatch).toHaveBeenCalledTimes(3);
        });

        it('ExitDispatchResult.failed が空でなければ event: exit_dispatch_failed ログを出す + Entry 評価は継続', async () => {
            const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
            try {
                const failedResult = ExitDispatchResult.of({
                    closed: [],
                    skipped: [],
                    failed: [
                        {
                            positionId: PositionId.from('test-id'),
                            strategy: StrategyName.SMA_CROSS,
                            errorName: 'Error',
                        },
                    ],
                });
                const dispatcherWithFailure = mockExitDispatcher(failedResult);
                const localSession = new TradingSession(
                    PAIR,
                    positionManager,
                    dispatcherWithFailure,
                    extremesUpdater,
                    entryQueue,
                    timeFrameBook,
                    marketDataStream,
                    candleHistoryPort,
                    makeBreaker(),
                    uiNotifier,
                );

                await localSession.onMarketData(fakeSnapshot);

                // failed ログ: event / failedCount が固定値で呼ばれる
                expect(errorSpy).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        event: 'exit_dispatch_failed',
                        failedCount: 1,
                    }),
                );
                // failed があっても Entry 評価まで進む
                expect(positionManager.handleSignals).toHaveBeenCalledTimes(1);
            } finally {
                errorSpy.mockRestore();
            }
        });
    });

    describe('kill-switch（#186）', () => {
        const seedKilledBreaker = (): ExitFailureCircuitBreaker => {
            // 閾値 1 の breaker に失敗を 1 件記録して kill 判定に達した状態を作る
            const breaker = makeBreaker(1);
            const id = PositionId.from('ghost-position');
            breaker.beginTick([id]);
            breaker.recordFailure(id);
            return breaker;
        };

        const makeSessionWith = (breaker: ExitFailureCircuitBreaker): TradingSession =>
            new TradingSession(
                PAIR,
                positionManager,
                exitDispatcher,
                extremesUpdater,
                entryQueue,
                timeFrameBook,
                marketDataStream,
                candleHistoryPort,
                breaker,
                uiNotifier,
            );

        it('kill 判定でセッション停止 + UI 通知 + Entry 評価はしない', async () => {
            const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
            try {
                const localSession = makeSessionWith(seedKilledBreaker());

                await localSession.onMarketData(fakeSnapshot);

                // セッションは停止している（stop の副作用）
                expect(marketDataStream.stop).toHaveBeenCalledTimes(1);
                expect(entryQueue.stop).toHaveBeenCalledTimes(1);
                // 発動根拠つきでログが出る
                expect(errorSpy).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        event: 'exit_kill_switch_fired',
                        positionId: 'ghost-position',
                        consecutiveFailures: 1,
                        threshold: 1,
                    }),
                );
                // UI に停止理由が通知される
                expect(uiNotifier.notifyTradingHalted).toHaveBeenCalledTimes(1);
                expect(vi.mocked(uiNotifier.notifyTradingHalted).mock.calls[0][0]).toContain(
                    'ghost-position',
                );
                // Entry 評価はスキップされる
                expect(positionManager.handleSignals).not.toHaveBeenCalled();
            } finally {
                errorSpy.mockRestore();
            }
        });

        it('発動後の onMarketData は何もしない（stopped ガード）', async () => {
            const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
            try {
                const localSession = makeSessionWith(seedKilledBreaker());

                await localSession.onMarketData(fakeSnapshot);
                await localSession.onMarketData(fakeSnapshot);

                // dispatch は発動 tick の 1 回だけ。通知も再発しない
                expect(exitDispatcher.dispatch).toHaveBeenCalledTimes(1);
                expect(uiNotifier.notifyTradingHalted).toHaveBeenCalledTimes(1);
            } finally {
                errorSpy.mockRestore();
            }
        });

        it('stop() が throw しても notifyTradingHalted は必ず呼ばれる', async () => {
            const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
            try {
                vi.mocked(marketDataStream.stop).mockRejectedValue(new Error('stream stop failed'));
                const localSession = makeSessionWith(seedKilledBreaker());

                await expect(localSession.onMarketData(fakeSnapshot)).resolves.toBeUndefined();

                expect(uiNotifier.notifyTradingHalted).toHaveBeenCalledTimes(1);
            } finally {
                errorSpy.mockRestore();
            }
        });

        it('notifyTradingHalted が throw しても停止は完了し、例外は伝搬しない', async () => {
            const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
            try {
                vi.mocked(uiNotifier.notifyTradingHalted).mockRejectedValue(new Error('通知失敗'));
                const localSession = makeSessionWith(seedKilledBreaker());

                await expect(localSession.onMarketData(fakeSnapshot)).resolves.toBeUndefined();

                expect(marketDataStream.stop).toHaveBeenCalledTimes(1);
            } finally {
                errorSpy.mockRestore();
            }
        });

        it('閾値未達なら停止せず Entry 評価まで進む', async () => {
            const breaker = makeBreaker(2);
            const id = PositionId.from('failing-position');
            breaker.beginTick([id]);
            breaker.recordFailure(id); // 1 回失敗（閾値 2 未達）
            const localSession = makeSessionWith(breaker);

            await localSession.onMarketData(fakeSnapshot);

            expect(marketDataStream.stop).not.toHaveBeenCalled();
            expect(uiNotifier.notifyTradingHalted).not.toHaveBeenCalled();
            expect(positionManager.handleSignals).toHaveBeenCalledTimes(1);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });
});
