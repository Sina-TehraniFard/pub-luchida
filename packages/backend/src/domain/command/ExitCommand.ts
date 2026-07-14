import { PositionId } from '../position/PositionId.js';
import { ExitReason } from './ExitReason.js';

/**
 * 決済理由の種類
 */
export const ExitType = {
  TAKE_PROFIT: 'TAKE_PROFIT', // 利確
  STOP_LOSS: 'STOP_LOSS', // 損切り
  FORCE_CLOSE: 'FORCE_CLOSE', // 強制クローズ（BT 期間終了 / TradingGuard / 緊急全決済）
} as const;
export type ExitType = (typeof ExitType)[keyof typeof ExitType];

/**
 * 決済命令。
 * ExitRule が「今決済すべき」と判断したときに返す。
 * Action 層がこれを受け取り、実際に決済注文を出す。
 * 現在は全量決済を前提とする（部分決済は対象外）。
 */
export class ExitCommand {
  private constructor(
    readonly positionId: PositionId,
    readonly type: ExitType,
    readonly reason: ExitReason, // なぜ決済するかの理由（ログ・UI表示用）
  ) {}

  static of(params: {
    positionId: PositionId;
    type: ExitType;
    reason: ExitReason;
  }): ExitCommand {
    return new ExitCommand(params.positionId, params.type, params.reason);
  }
}
