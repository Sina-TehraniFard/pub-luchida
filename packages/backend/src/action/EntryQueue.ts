import { EntryCommand } from '../domain/command/EntryCommand.js';
import { Money } from '../domain/Money.js';
import type { LogPort } from '../domain/port/LogPort.js';

import type { Clock } from '../port/Clock.js';
import type { EntryQueuePort } from '../port/EntryQueuePort.js';
import type { UiNotifier } from '../port/UiNotifier.js';

import type { EntryExecutor } from './EntryExecutor.js';

/**
 * キュー内の 1 エントリー（コマンド + enqueue 時刻）。
 */
type QueuedEntry = {
  command: EntryCommand;
  submittedAt: Date;
};

/**
 * EntryQueue オプション（TTL / drain 間隔）。
 */
export interface EntryQueueOptions {
  /** TTL（ミリ秒）。これを超えた古いシグナルは drain 時に drop。既定 3000ms。 */
  ttlMs?: number;
  /** drain タイマーの間隔（ミリ秒）。既定 100ms。 */
  drainIntervalMs?: number;
}

const DEFAULT_TTL_MS = 3000;
const DEFAULT_DRAIN_INTERVAL_MS = 100;

/**
 * シグナル発生から実発注までの間に挟むキュー。
 *
 * 設計書: docs/design/position-manager/policies.md 3 章。
 *
 * - FIFO + TTL 3 秒（drain 時判定 / 3.5 節）
 * - 並列 drain 再入は `draining` フラグで防止（C9 / 3.2 節）
 * - shutdown 時は残留分を即破棄（P12 確定 / 3.6 節 `dropAllAtShutdown`）
 * - 1 秒 1 件の実レート制限はここでは守らない（NH-1 / 3.4 節）
 */
export class EntryQueue implements EntryQueuePort {
  private readonly queue: QueuedEntry[] = [];
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** C9: drain の並列再入を防ぐ排他フラグ */
  private draining = false;
  /**
   * 進行中の drain を表す Promise。
   * stop() / drainAndWait() がこれを await することで、
   * in-flight の openPosition を握ったまま破棄される事故を防ぐ。
   */
  private currentDrainPromise: Promise<void> | null = null;

  private readonly ttlMs: number;
  private readonly drainIntervalMs: number;

  constructor(
    private readonly entryExecution: EntryExecutor,
    private readonly clock: Clock,
    private readonly logger: LogPort,
    private readonly uiNotifier: UiNotifier,
    options: EntryQueueOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.drainIntervalMs = options.drainIntervalMs ?? DEFAULT_DRAIN_INTERVAL_MS;
  }

  /**
   * drain タイマーを起動する。冪等（複数回呼んでも setInterval は二重起動しない）。
   *
   * `unref()` でプロセス終了を妨げない（H8 / Node.js 依存）。
   */
  start(): void {
    if (this.intervalHandle) return; // 冪等（3.3.2 節）
    this.intervalHandle = setInterval(() => {
      this.drain().catch((err) => {
        this.logger.error('drain エラー', { error: String(err) });
      });
    }, this.drainIntervalMs);
    // H8: Node.js 固有 API。プロセス終了を妨げない。
    this.intervalHandle.unref();
  }

  /**
   * drain タイマーを止め、残留分を全件 drop する（P12 確定 / NL-2）。
   *
   * shutdown = 強制決済を伴うため、残留シグナルは発注しない。
   *
   * 進行中の drain（in-flight の `openPosition`）は握り潰さず完了を待つ。
   * 待たないと、queue.shift() で取り出された後 await openPosition 中の要素が
   * dropAllAtShutdown でも回収されず無音で消える事故が起きる。
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    // 進行中の drain を待つ（in-flight の openPosition を完了させる）
    if (this.currentDrainPromise) {
      // drainOne 内で例外は捕捉済みなのでここでは再 throw させない
      await this.currentDrainPromise.catch(() => undefined);
    }
    await this.dropAllAtShutdown();
  }

  /**
   * シグナルを末尾に追加。stop() 後は無視（warn ではなく info / 3.10.4 節）。
   */
  enqueue(command: EntryCommand, submittedAt: Date): void {
    if (this.stopped) {
      this.logger.info('enqueue ignored after stop');
      return;
    }
    this.queue.push({ command, submittedAt });
  }

  /**
   * キュー先頭を 1 件処理する。
   *
   * - C9: `draining` で並列再入を防ぐ。進行中 drain がある場合はその完了を待ってから return（ビジーループ回避）
   * - 空キューも即 return
   * - 先頭が TTL 超過なら drop + LogPort.warn + UiNotifier.notifyEntryExpired
   * - 発注成功は LogPort.info、発注失敗は drop + LogPort.warn + UiNotifier.notifyEntryExpired
   *
   * 進行中の drain は `currentDrainPromise` に保持し、stop() / drainAndWait() が
   * これを await することで in-flight の `openPosition` を握り潰さない。
   */
  async drain(): Promise<void> {
    // C9: 並列 drain 再入防止（進行中があれば完了を待つ。即 return は drainAndWait のビジーループ原因）
    if (this.draining) {
      if (this.currentDrainPromise) {
        await this.currentDrainPromise.catch(() => undefined);
      }
      return;
    }
    if (this.queue.length === 0) return;

    this.draining = true;
    const promise = this.drainOne();
    this.currentDrainPromise = promise;
    try {
      await promise;
    } finally {
      this.draining = false;
      this.currentDrainPromise = null;
    }
  }

  /**
   * 先頭 1 件の実処理（TTL / 発注 / drop）。`drain()` から排他フラグの内側で呼ぶ。
   * 例外はここで全て捕捉する（呼び出し側は catch しなくてよい）。
   */
  private async drainOne(): Promise<void> {
    const head = this.queue.shift();
    if (!head) return;

    const now = this.clock.now();
    const age = now.getTime() - head.submittedAt.getTime();
    if (age > this.ttlMs) {
      this.logger.warn('signal dropped due to TTL', {
        age,
        ttl: this.ttlMs,
        strategy: head.command.strategyName,
        pair: head.command.pair.toString(),
      });
      // dropAllAtShutdown と同じく notify 失敗で entry を復活させない
      try {
        await this.uiNotifier.notifyEntryExpired(head.command);
      } catch (err) {
        this.logger.error('notifyEntryExpired failed at TTL drop', {
          error: String(err),
          age,
          ttl: this.ttlMs,
          strategy: head.command.strategyName,
          pair: head.command.pair.toString(),
        });
      }
      return;
    }
    try {
      await this.entryExecution.openPosition(head.command);
      this.logger.info('entry placed', {
        strategy: head.command.strategyName,
        pair: head.command.pair.toString(),
      });
    } catch (err) {
      this.logger.warn('placeEntry failed - signal dropped', {
        error: String(err),
        strategy: head.command.strategyName,
      });
      // notify 失敗で entry を復活させない（drop は確定）
      try {
        await this.uiNotifier.notifyEntryExpired(head.command);
      } catch (notifyErr) {
        this.logger.error('notifyEntryExpired failed at placeEntry drop', {
          error: String(notifyErr),
          strategy: head.command.strategyName,
          pair: head.command.pair.toString(),
        });
      }
      // drop（再投入しない）
    }
  }

  /**
   * 未発注シグナルの合計証拠金見込み（純関数 / C8）。
   *
   * 設計書 3.3.1: EntryCommand 生成時に計算済みの requiredMargin を合算するのみ。
   * EntryQueue はレート / MarginRate を知らない。
   */
  reservedMargin(): Money {
    return this.queue.reduce(
      (acc, q) => acc.plus(q.command.requiredMargin),
      Money.jpy('0'),
    );
  }

  /**
   * 通常運用での残留 drain。キューが空になるまで drain を繰り返す。
   *
   * 進行中の drain がある場合はその完了を待ってから次へ進む（ビジーループ回避）。
   * shutdown 時は呼ばない（NL-2 / shutdown は dropAllAtShutdown 一択）。
   */
  async drainAndWait(): Promise<void> {
    while (this.queue.length > 0 || this.draining) {
      if (this.draining && this.currentDrainPromise) {
        await this.currentDrainPromise.catch(() => undefined);
      } else {
        await this.drain();
      }
    }
  }

  /**
   * shutdown 専用。残留分を発注せず全件 drop する（P12 確定 / NL-2）。
   *
   * 各 drop で LogPort.info で運用ログを出し、UiNotifier.notifyEntryExpired で
   * UI 表示も消す。
   *
   * notifyEntryExpired が個別に throw しても残りのエントリーが drop されないと
   * shutdown 時にキューが残留する（強制決済と整合しない）。
   * よって個々の通知失敗は LogPort.error で記録するに留め、ループは継続する。
   */
  async dropAllAtShutdown(): Promise<void> {
    while (this.queue.length > 0) {
      const dropped = this.queue.shift();
      if (!dropped) break;
      this.logger.info('entry dropped at shutdown', {
        strategy: dropped.command.strategyName,
        pair: dropped.command.pair.toString(),
      });
      try {
        await this.uiNotifier.notifyEntryExpired(dropped.command);
      } catch (err) {
        // 通知失敗で残りの drop を止めない（shutdown は強制決済と対応しているため
        // キューを残留させると整合性が崩れる）
        this.logger.error('notifyEntryExpired failed at shutdown drop', {
          error: String(err),
          strategy: dropped.command.strategyName,
          pair: dropped.command.pair.toString(),
        });
      }
    }
  }
}
