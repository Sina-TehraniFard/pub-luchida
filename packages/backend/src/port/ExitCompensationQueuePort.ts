import type { Position } from '../domain/position/Position.js';
import type { PositionId } from '../domain/position/PositionId.js';

/**
 * 決済の部分成功（broker 成功 + DB 反映失敗）を補償するキューのポート（DI 用 / #186）。
 *
 * 役割:
 *   - 補償: DB への CLOSED 反映を成功するまで非同期リトライ
 *   - シールド: `has()` で「決済済み・DB 反映待ち」を知らせ、
 *     存在しない建玉への決済リトライ（発注スパム）を防ぐ
 *
 * 配置: `packages/backend/src/port/ExitCompensationQueuePort.ts`（Port 層）。
 * 具象実装は `packages/backend/src/action/ExitCompensationQueue.ts`。
 * 前例: EntryQueuePort。
 */
export interface ExitCompensationQueuePort {
  start(): void;
  stop(): Promise<void>;
  /** CLOSED 遷移済み集約の永続化リトライを登録（通常の補償） */
  enqueueUpdate(position: Position): void;
  /** ステータスのみ CLOSED 化する縮退補償を登録（Position.close 失敗時） */
  enqueueMarkClosed(positionId: PositionId): void;
  /** 補償待ち（= broker 決済済み・DB 反映待ち）か。ExitDispatcher のシールド判定用 */
  has(positionId: PositionId): boolean;
  /** 補償待ち件数（観測用） */
  size(): number;
  /** リトライタイマーから呼ばれる */
  drain(): Promise<void>;
}
