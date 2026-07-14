import type { Position } from '../domain/position/Position.js';
import type { PositionId } from '../domain/position/PositionId.js';
import type { PositionRepository } from '../port/PositionRepository.js';
import type { ExitCompensationQueuePort } from '../port/ExitCompensationQueuePort.js';
import type { LogPort } from '../domain/port/LogPort.js';

/**
 * 補償 1 件分。broker 決済は確定済みで、DB への反映だけが残っている状態。
 * - `update`: CLOSED 遷移済みの集約を丸ごと永続化（決済価格・損益あり / 通常の補償）
 * - `markClosed`: ステータスのみ CLOSED 化（`Position.close()` 自体が失敗した縮退経路。
 *   決済価格・損益は失われるが、ゴースト解消を優先する）
 */
type CompensationEntry =
  | { readonly kind: 'update'; readonly position: Position; attempts: number }
  | { readonly kind: 'markClosed'; readonly positionId: PositionId; attempts: number };

export interface ExitCompensationQueueOptions {
  /** リトライ間隔（ミリ秒）。既定 5000ms */
  retryIntervalMs?: number;
  /** この回数連続で失敗したら以降のリトライ失敗ログを error に昇格する。既定 10 */
  escalateAfterAttempts?: number;
}

const DEFAULT_RETRY_INTERVAL_MS = 5_000;
const DEFAULT_ESCALATE_AFTER_ATTEMPTS = 10;

/**
 * 決済の部分成功（broker 成功 + DB 反映失敗）を補償するリトライキュー（#186）。
 *
 * broker 側はもう建玉が閉じているのに DB が OPEN のまま、というゴーストポジションを
 * 記録し、DB への反映を固定間隔で非同期リトライする。
 *
 * このキューは 2 つの役割を持つ:
 * - **補償**: `PositionRepository.update` / `markClosed` を成功するまでリトライする
 * - **シールド**: `has()` で ExitDispatcher に「このポジションは決済済み・DB 反映待ち」を
 *   知らせ、存在しない建玉への決済リトライ（毎 tick の無効注文スパム）を防ぐ
 *
 * リトライは打ち切らない。エントリを落とすとシールドも消えて発注スパムが再発するうえ、
 * 「諦めた後に誰が復旧させるか」の答えがないため。回数上限の代わりに、連続失敗が
 * `escalateAfterAttempts` に達したら失敗ログを warn → error に昇格して人間に知らせる。
 * DB が復旧すれば次の drain で収束し、プロセス再起動で揮発した場合は起動時の
 * 建玉 reconciliation（main.ts）と定期 sync が同じ不整合を掃除する。
 *
 * タイマー運用（start/stop 冪等・unref・排他 drain）は EntryQueue の前例に倣う。
 */
export class ExitCompensationQueue implements ExitCompensationQueuePort {
  private readonly entries = new Map<string, CompensationEntry>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  /** 並列 drain の再入防止 */
  private draining = false;
  /** 進行中の drain。stop() が await して in-flight の DB 書き込みを握り潰さない */
  private currentDrainPromise: Promise<void> | null = null;

  private readonly retryIntervalMs: number;
  private readonly escalateAfterAttempts: number;

  constructor(
    private readonly positionRepository: PositionRepository,
    private readonly logger: LogPort,
    options: ExitCompensationQueueOptions = {},
  ) {
    this.retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
    this.escalateAfterAttempts =
      options.escalateAfterAttempts ?? DEFAULT_ESCALATE_AFTER_ATTEMPTS;
  }

  /** CLOSED 遷移済み集約の永続化リトライを登録する（同一ポジションは上書きせず維持） */
  enqueueUpdate(position: Position): void {
    const key = position.id.toString();
    if (this.entries.has(key)) return;
    this.entries.set(key, { kind: 'update', position, attempts: 0 });
    this.logger.warn('補償キューに登録（DB update リトライ待ち）', {
      event: 'exit_compensation_enqueued',
      kind: 'update',
      positionId: key,
      queueSize: this.entries.size,
    });
  }

  /** ステータスのみ CLOSED 化する縮退補償を登録する（Position.close 失敗時） */
  enqueueMarkClosed(positionId: PositionId): void {
    const key = positionId.toString();
    if (this.entries.has(key)) return;
    this.entries.set(key, { kind: 'markClosed', positionId, attempts: 0 });
    this.logger.warn('補償キューに登録（markClosed リトライ待ち）', {
      event: 'exit_compensation_enqueued',
      kind: 'markClosed',
      positionId: key,
      queueSize: this.entries.size,
    });
  }

  /** 補償待ち（= broker 決済済み・DB 反映待ち）のポジションか。ExitDispatcher のシールド判定用 */
  has(positionId: PositionId): boolean {
    return this.entries.has(positionId.toString());
  }

  /** 補償待ち件数（観測用） */
  size(): number {
    return this.entries.size;
  }

  /** リトライタイマーを起動する。冪等。unref でプロセス終了を妨げない */
  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.drain().catch((err) => {
        this.logger.error('補償 drain エラー', { error: String(err) });
      });
    }, this.retryIntervalMs);
    this.intervalHandle.unref();
  }

  /**
   * タイマーを止める。進行中の drain は完了を待つ（in-flight の DB 書き込みを守る）。
   * 未収束のエントリは破棄せず残すが、プロセス終了で揮発する前提のため
   * 残件があれば warn で人間と起動時 reconciliation に引き継ぐ。
   */
  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.currentDrainPromise) {
      await this.currentDrainPromise.catch(() => undefined);
    }
    if (this.entries.size > 0) {
      this.logger.warn('補償キューに未収束エントリを残して停止（起動時 reconciliation に委譲）', {
        event: 'exit_compensation_pending_at_shutdown',
        positionIds: [...this.entries.keys()],
      });
    }
  }

  /**
   * 全エントリを 1 巡リトライする。成功したものはキューから外す。
   * 例外はエントリ単位で捕捉し、1 件の失敗で他のリトライを止めない。
   */
  async drain(): Promise<void> {
    if (this.draining) {
      if (this.currentDrainPromise) {
        await this.currentDrainPromise.catch(() => undefined);
      }
      return;
    }
    if (this.entries.size === 0) return;

    this.draining = true;
    const promise = this.drainAll();
    this.currentDrainPromise = promise;
    try {
      await promise;
    } finally {
      this.draining = false;
      this.currentDrainPromise = null;
    }
  }

  private async drainAll(): Promise<void> {
    for (const [key, entry] of [...this.entries]) {
      try {
        if (entry.kind === 'update') {
          await this.positionRepository.update(entry.position);
        } else {
          await this.positionRepository.markClosed(entry.positionId);
        }
        this.entries.delete(key);
        this.logger.info('補償成功 - ゴーストポジション解消', {
          event: 'exit_compensation_recovered',
          kind: entry.kind,
          positionId: key,
          attempts: entry.attempts + 1,
          queueSize: this.entries.size,
        });
      } catch (err) {
        entry.attempts++;
        const context = {
          event: 'exit_compensation_retry_failed',
          kind: entry.kind,
          positionId: key,
          attempts: entry.attempts,
          error: String(err),
        };
        // 長期化はディスパッチ抑止（シールド）が続いている合図なので error に昇格して知らせる
        if (entry.attempts >= this.escalateAfterAttempts) {
          this.logger.error('補償リトライ失敗が長期化', context);
        } else {
          this.logger.warn('補償リトライ失敗 - 次周期で再試行', context);
        }
      }
    }
  }
}
