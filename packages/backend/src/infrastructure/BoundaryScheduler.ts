import { Clock } from '../port/Clock.js';
import { BoundaryWatchdogPort } from '../port/BoundaryWatchdogPort.js';
import { TimeFrame, durationMs, label as tfLabel } from '../domain/market/TimeFrame.js';
import { Logger } from './logging/Logger.js';

/** タイマー機構の抽象（テストで差し替え可能にする） */
export interface TimerApi {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

/** 本番用 TimerApi（setTimeout / clearTimeout） */
export const SYSTEM_TIMER: TimerApi = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * 壁時計（wall-clock）タイマー。
 *
 * 各対象時間足について「次の足境界 + offsetMs」に発火し、発火のたびに次の境界へ再スケジュールする。
 * tick の受信状態に依存しない。WS 切断中で tick が1つも来ていなくても、時刻が来れば必ず発火する。
 * これが「WS が死んでいる間にズレた足」を後から確実に拾う仕組みの肝。
 *
 * テスト容易性のため Clock（現在時刻）と TimerApi（setTimeout）を注入可能にする。
 */
export class BoundaryScheduler implements BoundaryWatchdogPort {
  private readonly logger = new Logger('BoundaryScheduler', 'MARKET');
  private readonly handles = new Map<TimeFrame, unknown>();
  private running = false;

  constructor(
    private readonly clock: Clock,
    private readonly timeFrames: readonly TimeFrame[],
    private readonly offsetMs: number,
    private readonly onBoundary: (timeFrame: TimeFrame) => Promise<void>,
    private readonly timer: TimerApi = SYSTEM_TIMER,
  ) {}

  /** 各時間足の次境界 + offset にタイマーを登録する */
  start(): void {
    if (this.running) return;
    this.running = true;
    for (const tf of this.timeFrames) {
      this.scheduleNext(tf);
    }
  }

  /** 全タイマーを解除する（孤児タイマー防止） */
  stop(): void {
    this.running = false;
    for (const handle of this.handles.values()) {
      this.timer.clear(handle);
    }
    this.handles.clear();
  }

  /** 指定足の「次境界 + offsetMs」までの待ち時間を計算し、タイマーを登録する */
  private scheduleNext(timeFrame: TimeFrame): void {
    if (!this.running) return;
    const now = this.clock.now().getTime();
    const duration = durationMs(timeFrame);
    const nextBoundary = Math.floor(now / duration) * duration + duration;
    const fireAt = nextBoundary + this.offsetMs;
    const delay = Math.max(0, fireAt - now);

    const handle = this.timer.set(() => {
      void this.fire(timeFrame);
    }, delay);
    this.handles.set(timeFrame, handle);
  }

  /** 発火: onBoundary を呼び、その後次の境界へ再スケジュールする */
  private async fire(timeFrame: TimeFrame): Promise<void> {
    try {
      await this.onBoundary(timeFrame);
    } catch (err) {
      this.logger.warn('境界コールバックでエラー', {
        timeFrame: tfLabel(timeFrame),
        error: String(err),
      });
    } finally {
      this.scheduleNext(timeFrame);
    }
  }
}
