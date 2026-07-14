import { CurrencyPair, currencyPairEquals } from '../domain/market/CurrencyPair.js';
import { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';
import { TimeFrameBook } from '../domain/market/TimeFrameBook.js';
import { EntryQueuePort } from '../port/EntryQueuePort.js';
import { CandleHistoryPort } from '../port/CandleHistoryPort.js';
import { MarketDataStreamPort } from '../port/MarketDataStreamPort.js';
import type { UiNotifier } from '../port/UiNotifier.js';
import type { ExitFailureCircuitBreaker } from '../domain/guard/ExitFailureCircuitBreaker.js';
import { LIVE_TIMEFRAMES } from '../domain/market/TimeFrame.js';
import { Logger } from '../infrastructure/logging/Logger.js';
import { PositionManager } from './PositionManager.js';
import { ExitDispatcher } from './ExitDispatcher.js';
import { PositionExtremesUpdater } from './PositionExtremesUpdater.js';
import { BoundaryWatchdogPort, NoopBoundaryWatchdog } from '../port/BoundaryWatchdogPort.js';

/**
 * 取引セッション全体の制御。1 インスタンス = 1 通貨ペア（pair-bound）。
 *
 * - 起動: 過去データ取得 → SMA 初期化 → 市場監視開始
 * - 運用: tick ごとに extremesUpdater.update → exitDispatcher.dispatch → positionManager.handleSignals
 * - 停止: 市場監視の終了
 *
 * Step 8 で Exit 評価を ExitDispatcher へ完全委譲（policies.md 2.5）。
 * 本クラスは lifecycle（start/stop）と routing（onMarketData の順序保証 + pair-bound guard）に絞られる。
 * kill-switch（#186）も lifecycle の一部として本クラスが担う（dispatch 後に停止回路へ kill 判定を問い、
 * 発動時は stop() + UiNotifier 通知）。詳細は docs/design/position-manager/exit-compensation.md。
 *
 * Note (再入 coalesce / N1):
 * MarketDataStream.subscribe の listener 呼び出しが await されないため、
 * tick 密集時に Promise 完了前の再入が起こり得る。processing 中の snapshot は
 * pendingSnapshot に最新 1 件を coalesce 保持し、処理完了後に再評価する。
 *
 * Note (tick drop の許容範囲 / 設計判断):
 * 中間 tick は drop されるが、最新 tick は coalesce 経由で必ず再評価される。
 * - Entry/Exit シグナル判定は最新 tick の MarketSnapshot で十分（過去 tick の参照は SMA 累積側で吸収）
 * - MFE/MAE は中間 tick の極値を取りこぼし得るが、保有期間中の最新 tick で highest/lowest を
 *   逐次更新するため、最終的な極値が大きくずれることは稀
 * - 1 tick 内の SL/TP ヒットを取り逃がす可能性は理論上あるが、tick の到着間隔が
 *   現実的に密でない（GMO ticker ≈ 100ms 間隔）ため処理時間が間に合う前提
 * 真の解決（全件 drain queue 化）は実装複雑度が大きく、運用上問題が顕在化した時点で再評価する。
 *
 * Note (ドテン仕様の所在 / X2):
 * `onMarketData` で `extremesUpdater.update → exitDispatcher.dispatch → positionManager.handleSignals` の
 * 順を守ることで、同 tick で「決済確定 → 反対方向エントリー」（ドテン）が成立する。
 *
 * Note (EntryQueue lifecycle の責務分離 / X6):
 * `entryQueue` の start/stop は TradingSession の責務、enqueue は PositionManager の責務。
 * `start()` 順序は「初期化失敗時の孤児タイマー防止」を意図する（drain を最後に起動）。
 *
 * 設計書: docs/design/position-manager/policies.md 1.4 / 2.5 / 2.7.1 / 3.6 / 4.1、step8-brief.md 5.4、step8-pr-b-impl-plan.md。
 */
export class TradingSession {
    private readonly logger = new Logger('TradingSession', 'TRADE');
    private processing = false;
    /**
     * 再入時の最新 snapshot を coalesce して保持する。
     * processing 中に到着した snapshot は古いものを上書きし、
     * 処理完了後に最新の 1 件だけを再評価する（中間 tick は drop してよいが
     * 最新 tick のシグナルは取り逃がさない）。
     */
    private pendingSnapshot: MarketSnapshot | null = null;
    /**
     * stop() 開始フラグ。stop 後の onMarketData では Entry / Exit のいずれも評価しない。
     * 進行中の handleSignals / dispatch は中断できないが、新規起動は防げる。
     */
    private stopped = false;

    constructor(
        private readonly pair: CurrencyPair,
        private readonly positionManager: PositionManager,
        private readonly exitDispatcher: ExitDispatcher,
        private readonly extremesUpdater: PositionExtremesUpdater,
        private readonly entryQueue: EntryQueuePort,
        private readonly timeFrameBook: TimeFrameBook,
        private readonly marketDataStream: MarketDataStreamPort,
        private readonly candleHistoryPort: CandleHistoryPort,
        /** ExitDispatcher と同一インスタンスを注入する（dispatch が記録し、本クラスが kill 判定を問う / #186） */
        private readonly exitFailureBreaker: ExitFailureCircuitBreaker,
        private readonly uiNotifier: UiNotifier,
        private readonly boundaryWatchdog: BoundaryWatchdogPort = NoopBoundaryWatchdog,
    ) {}

    /**
     * セッション開始
     * - コンストラクタで受け取った通貨ペアの各時間足の過去データを取得して SMA を初期化
     * - 市場監視を開始
     * - 最後に EntryQueue の drain タイマーを起動
     *
     * 順序の意図（policies.md 3.6 / 初期化失敗時のタイマー残留防止）:
     *   fetchRecent / warmUp / marketDataStream.start のいずれかが throw した場合、
     *   先に entryQueue.start でタイマーを起動していると、stop が呼ばれず drain が
     *   走り続けて孤児タイマーになる。drain タイマーは「初期化が全部完了した後に」起動する。
     *
     * start 内ロールバックを持たないのは、この順序（タイマー系を最後に起動）が
     * 「起動済みコンポーネントが孤児タイマーを残さない」ことを構造で保証するため。
     * **start() が throw した場合、呼び出し側は stop() を呼んで起動済み分を巻き取る責務がある**
     * （stop は best-effort で全系統を止める）。
     */
    async start(): Promise<void> {
        for (const timeFrame of LIVE_TIMEFRAMES) {
            const candles = await this.candleHistoryPort.fetchRecent(timeFrame, 200);
            this.timeFrameBook.warmUp(timeFrame, candles);
        }
        await this.marketDataStream.start();
        // タイマー系（drain / 壁時計補正）は初期化が全部完了した後にまとめて起動する。
        // 先に起動すると、後続の初期化が throw した際に stop が呼ばれず孤児タイマーになる（BR-11）。
        this.entryQueue.start();
        this.boundaryWatchdog.start();
    }

    /**
     * セッション停止。**冪等**: 2 回目以降の呼び出しは早期 return する。
     */
    async stop(): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
        let primaryError: unknown;
        // 停止は best-effort で全系統を確実に手放す。1 つの失敗で後続を中断しない。
        try {
            this.boundaryWatchdog.stop();
        } catch (err) {
            primaryError = err;
            this.logger.error('boundaryWatchdog.stop 失敗 - 後続停止は継続', { error: String(err) });
        }
        try {
            await this.marketDataStream.stop();
        } catch (err) {
            if (primaryError === undefined) primaryError = err;
            this.logger.error('marketDataStream.stop 失敗 - entryQueue.stop は継続', { error: String(err) });
        }
        try {
            await this.entryQueue.stop();
        } catch (err) {
            if (primaryError === undefined) primaryError = err;
            this.logger.error('entryQueue.stop 失敗', { error: String(err) });
        }
        if (primaryError !== undefined) throw primaryError;
    }

    /**
     * 市場データ到着時の処理。
     * 順序: 1) MFE/MAE 更新 → 2) Exit 評価 → 3) Entry 評価（ドテン契約 / policies.md 2.7.1）。
     *
     * stopped 中は何もしない（一括ガード）。
     *
     * Note (再入 coalesce / N1):
     *   processing 中の呼び出しは pendingSnapshot に最新を上書き保持し、
     *   processing 完了後に最新 1 件だけを処理する。中間 tick は drop されるが
     *   最新 tick のシグナルは取り逃がさない（金融的に保守的）。
     *
     * pair-bound 不変条件: snapshot の pair が本セッションの pair と一致しないものは無視する。
     */
    async onMarketData(snapshot: MarketSnapshot): Promise<void> {
        if (this.stopped) return;
        if (!currencyPairEquals(snapshot.pair, this.pair)) {
            this.logger.warn('snapshot.pair が session の pair と不一致 - 無視', {
                sessionPair: this.pair.toString(),
                snapshotPair: snapshot.pair.toString(),
            });
            return;
        }
        if (this.processing) {
            this.pendingSnapshot = snapshot;
            return;
        }
        this.processing = true;
        let primaryError: unknown;
        try {
            await this.process(snapshot);
        } catch (err) {
            primaryError = err;
        }
        // process が throw しても pendingSnapshot を drain してから rethrow する。
        // 「処理中に来た最新 tick」を初回エラーで取り逃がさない保守的方針。
        while (this.pendingSnapshot !== null && !this.stopped) {
            const next = this.pendingSnapshot;
            this.pendingSnapshot = null;
            try {
                await this.process(next);
            } catch (err) {
                if (primaryError === undefined) primaryError = err;
            }
        }
        this.processing = false;
        this.pendingSnapshot = null;
        if (primaryError !== undefined) throw primaryError;
    }

    private async process(snapshot: MarketSnapshot): Promise<void> {
        await this.extremesUpdater.update(this.pair, snapshot);
        const result = await this.exitDispatcher.dispatch(this.pair, snapshot);
        if (result.failed.length > 0) {
            this.logger.error('ExitDispatch 失敗あり', {
                event: 'exit_dispatch_failed',
                failedCount: result.failed.length,
                failed: result.failed.map((f) => ({
                    positionId: f.positionId.toString(),
                    strategy: f.strategy,
                    errorName: f.errorName,
                })),
            });
        }
        // kill-switch（#186）: 同一ポジションの決済連続失敗が閾値に達したらセッションを止める。
        // 「決済が恒久的に失敗する状態」で broker へ API を連打し続けるより、
        // 停止して人間に知らせるほうが安全（ポジションは broker 側に残る）。
        // 定期 sync（main.ts / 1 分間隔）はセッション外で動き続けるため、
        // ゴーストポジション起因なら停止後も DB 不整合は自然回復する。
        const killDetail = this.exitFailureBreaker.killDetail();
        if (killDetail) {
            this.logger.error('決済の連続失敗が閾値到達 - kill-switch 発動でセッション停止', {
                event: 'exit_kill_switch_fired',
                ...killDetail,
            });
            // stop() は best-effort 停止後に最初のエラーを rethrow する契約だが、
            // kill 経路では停止通知（人間への最終報告）を必ず試みるため握って記録する。
            // stopped フラグは stop() 冒頭で立つので、throw しても新規評価は止まっている。
            try {
                await this.stop();
            } catch (err) {
                this.logger.error('kill-switch 停止中にエラー - 通知は継続', { error: String(err) });
            }
            try {
                await this.uiNotifier.notifyTradingHalted(
                    `決済の連続失敗が閾値に到達（position=${killDetail.positionId} / ` +
                    `連続 ${killDetail.consecutiveFailures} 回 / 閾値 ${killDetail.threshold}）。` +
                    `取引セッションを停止しました。原因解消後に再起動してください。`,
                );
            } catch (err) {
                this.logger.error('notifyTradingHalted 失敗', { error: String(err) });
            }
            return; // 停止後に Entry 評価はしない
        }
        await this.positionManager.handleSignals(this.pair, snapshot);
    }
}
