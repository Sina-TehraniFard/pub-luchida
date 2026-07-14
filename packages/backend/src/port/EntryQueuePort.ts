import type { EntryCommand } from '../domain/command/EntryCommand.js';
import type { Money } from '../domain/Money.js';

/**
 * EntryQueue ポート（DI 用）。
 *
 * 設計書: docs/design/position-manager/policies.md 3.3 章。
 *
 * 役割:
 *   - 順序保持（FIFO）
 *   - TTL 破棄（古シグナルの drop）
 *   - 排他 drain（C9: 並列再入防止）
 *
 * 1 秒 1 件の実レート制限は本ポートの責務外。`GmoRestClient.throttlePost` に集約する。
 *
 * 配置: `packages/backend/src/port/EntryQueuePort.ts`（Port 層）。
 * 具象実装は `packages/backend/src/action/EntryQueue.ts`。
 */
export interface EntryQueuePort {
  start(): void;
  stop(): Promise<void>;
  enqueue(command: EntryCommand, submittedAt: Date): void;
  /** drain タイマーから呼ばれる */
  drain(): Promise<void>;
  /** 未発注シグナルの合計証拠金見込み */
  reservedMargin(): Money;
  /** 通常運用での残留 drain（shutdown 時は呼ばない / NL-2） */
  drainAndWait(): Promise<void>;
  /** shutdown 専用: 残留分を発注せず全件 drop（NL-2 / P12 確定） */
  dropAllAtShutdown(): Promise<void>;
}
