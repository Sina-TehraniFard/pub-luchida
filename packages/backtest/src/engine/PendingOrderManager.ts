import type { EntryCommand } from '@luchida/backend/domain/command/EntryCommand.js';
import type { ExitCommand } from '@luchida/backend/domain/command/ExitCommand.js';
import type { Position } from '@luchida/backend/domain/position/Position.js';
import type { Tick } from '@luchida/backend/domain/market/tick/Tick.js';

/**
 * 約定待ちのエントリー注文。
 * acceptEntryOrder で登録され、checkEntryFill で約定確認する。
 */
export interface PendingEntry {
  readonly command: EntryCommand;
  readonly fillableAt: number; // ミリ秒 UNIX タイムスタンプ
}

/**
 * 約定待ちのエグジット注文。
 * acceptExitOrder で登録され、checkExitFill で約定確認する。
 */
export interface PendingExit {
  readonly command: ExitCommand;
  readonly position: Position;
  readonly fillableAt: number;
}

/**
 * 約定遅延の状態を管理する。
 *
 * 責務:
 * - 発注受け付け（acceptEntryOrder / acceptExitOrder）
 * - 約定判定（checkEntryFill / checkExitFill）
 * - ストリーム終了時の決済（settleAtStreamEnd）
 *
 * delayMs=0 の場合は発注受け付け時刻と同時刻以降の任意の tick で即約定する。
 */
export class PendingOrderManager {
  private pendingEntry: PendingEntry | null = null;
  private pendingExit: PendingExit | null = null;

  constructor(private readonly delayMs: number) {}

  /**
   * エントリー注文を受け付ける。
   * 既存の pending entry がある場合はエラー（上書き禁止、二重受付は呼び出し側のバグ）。
   */
  acceptEntryOrder(command: EntryCommand, tick: Tick): void {
    if (this.pendingEntry !== null) {
      throw new Error('PendingOrderManager: pending entry が既に存在します（二重受付）');
    }
    const fillableAt = tick.timestamp().toDate().getTime() + this.delayMs;
    this.pendingEntry = { command, fillableAt };
  }

  /**
   * エグジット注文を受け付ける。
   * 既存の pending exit がある場合はエラー（上書き禁止、二重受付は呼び出し側のバグ）。
   */
  acceptExitOrder(command: ExitCommand, position: Position, tick: Tick): void {
    if (this.pendingExit !== null) {
      throw new Error('PendingOrderManager: pending exit が既に存在します（二重受付）');
    }
    const fillableAt = tick.timestamp().toDate().getTime() + this.delayMs;
    this.pendingExit = { command, position, fillableAt };
  }

  hasPendingEntry(): boolean {
    return this.pendingEntry !== null;
  }

  hasPendingExit(): boolean {
    return this.pendingExit !== null;
  }

  /**
   * エントリー・エグジットのいずれかが pending であるか。
   * エントリー判定のスキップ条件として使う。
   */
  hasAnyPending(): boolean {
    return this.hasPendingEntry() || this.hasPendingExit();
  }

  /**
   * 現在の tick 時刻が fillableAt 以降であれば約定成立とみなす。
   * 約定したら pending をクリアして PendingEntry を返す。
   * 未約定なら null を返す。
   */
  checkEntryFill(tick: Tick): PendingEntry | null {
    if (this.pendingEntry === null) return null;
    const tickMs = tick.timestamp().toDate().getTime();
    if (tickMs < this.pendingEntry.fillableAt) return null;
    const filled = this.pendingEntry;
    this.pendingEntry = null;
    return filled;
  }

  /**
   * 現在の tick 時刻が fillableAt 以降であれば約定成立とみなす。
   * 約定したら pending をクリアして PendingExit を返す。
   * 未約定なら null を返す。
   */
  checkExitFill(tick: Tick): PendingExit | null {
    if (this.pendingExit === null) return null;
    const tickMs = tick.timestamp().toDate().getTime();
    if (tickMs < this.pendingExit.fillableAt) return null;
    const filled = this.pendingExit;
    this.pendingExit = null;
    return filled;
  }

  /**
   * tick ストリーム終了時の処理。
   *
   * - 保留中エグジット: fillableAt を無視して強制的に約定させる（PendingExit を返す）
   * - 保留中エントリー: キャンセル（ストリーム終了後は約定できない）
   *
   * 約定価格は呼び出し側（TickEngine）が最終 tick から決める。本メソッドは
   * 保留状態の解決のみを担い、価格には関与しない（引数は呼び出し対称性のため受ける）。
   */
  settleAtStreamEnd(_finalTick: Tick): { exitFill: PendingExit | null } {
    // エントリーはキャンセル
    this.pendingEntry = null;

    if (this.pendingExit === null) {
      return { exitFill: null };
    }

    // エグジットは fillableAt を無視して強制的に約定させる
    const exitFill = this.pendingExit;
    this.pendingExit = null;
    return { exitFill };
  }
}
