import { ExitCommand, ExitType } from '../../command/ExitCommand.js';
import { ExitReason } from '../../command/ExitReason.js';
import { DoNothing } from '../../command/DoNothing.js';
import type { ExitRule } from '../ExitRule.js';
import type { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import type { Position } from '../../position/Position.js';

/**
 * 時間ベース強制決済。
 *
 * 保有時間が maxHoldBars 本分（15分足なら maxHoldBars × 15分）を
 * 超えたら成行決済する。SMAクロス待ちで含み益が蒸発するのを防ぐ。
 */
export class TimedExitRule implements ExitRule {
  private readonly maxHoldMs: number;

  constructor(maxHoldBars: number, barDurationMs: number) {
    this.maxHoldMs = maxHoldBars * barDurationMs;
  }

  shouldExit(snapshot: MarketSnapshot, position: Position): ExitCommand | DoNothing {
    const now = snapshot.capturedAt.toDate().getTime();
    const opened = position.openedAt.toDate().getTime();
    const held = now - opened;

    if (held >= this.maxHoldMs) {
      const hours = (this.maxHoldMs / 3_600_000).toFixed(1);
      return ExitCommand.of({
        positionId: position.id,
        type: ExitType.FORCE_CLOSE,
        reason: ExitReason.of(`時間ベース強制決済（${hours}時間）`),
      });
    }

    return DoNothing.instance;
  }
}
