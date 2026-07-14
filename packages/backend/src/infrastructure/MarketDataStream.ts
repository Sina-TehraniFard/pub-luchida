import { MarketDataPort } from '../port/MarketDataPort.js';
import { MarketDataStreamPort } from '../port/MarketDataStreamPort.js';
import { TimeFrameBook } from '../domain/market/TimeFrameBook.js';
import { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';
import { Logger } from './logging/Logger.js';

/**
 * tick 受信から MarketSnapshot 組み立てまでの中継
 * - MarketDataPort から Tick を受け取る
 * - TimeFrameBook に渡して足・指標を更新する
 * - 完成した MarketSnapshot を listener に通知する
 * - 60秒ごとにハートビートログを出力して稼働状態を可視化する
 */
export class MarketDataStream implements MarketDataStreamPort {
    private readonly logger = new Logger('MarketDataStream', 'MARKET');
    private unsubscribe: (() => void) | null = null;
    private tickCount = 0;
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly marketDataPort: MarketDataPort,
        private readonly timeFrameBook: TimeFrameBook,
        private readonly listener: (snapshot: MarketSnapshot) => void,
    ) {}

    async start(): Promise<void> {
        await this.marketDataPort.connect();
        this.unsubscribe = this.marketDataPort.subscribe((tick) => {
            this.tickCount++;
            const snapshot = this.timeFrameBook.onTick(tick);
            this.listener(snapshot);
        });
        this.startHeartbeat();
    }

    async stop(): Promise<void> {
        this.stopHeartbeat();
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        await this.marketDataPort.disconnect();
    }

    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            this.logger.info(`稼働中 累計${this.tickCount}tick`, { tickCount: this.tickCount });
        }, 60_000);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
}
