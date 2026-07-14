import { ExitCommand } from '../../command/ExitCommand.js';
import { DoNothing } from '../../command/DoNothing.js';
import type { ExitRule } from '../ExitRule.js';
import type { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import type { Position } from '../../position/Position.js';

/**
 * 複数の ExitRule を1つにまとめる。
 * 先頭から順に評価し、最初に ExitCommand を返した Rule の結果を採用する。
 */
export class CompositeExitRule implements ExitRule {
  constructor(private readonly rules: ReadonlyArray<ExitRule>) {
    if (rules.length === 0) {
      throw new Error('CompositeExitRule: ExitRule が0個です');
    }
  }

  shouldExit(snapshot: MarketSnapshot, position: Position): ExitCommand | DoNothing {
    for (const rule of this.rules) {
      const result = rule.shouldExit(snapshot, position);
      if (result instanceof ExitCommand) return result;
    }
    return DoNothing.instance;
  }
}
