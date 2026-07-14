import { describe, it, expect, vi } from 'vitest';

import { ExitCommand, ExitType } from '../../command/ExitCommand.js';
import { DoNothing } from '../../command/DoNothing.js';
import { ExitReason } from '../../command/ExitReason.js';
import { PositionId } from '../../position/PositionId.js';
import type { ExitRule } from '../ExitRule.js';
import type { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import type { Position } from '../../position/Position.js';

import { CompositeExitRule } from './CompositeExitRule.js';

const dummySnapshot = {} as MarketSnapshot;
const dummyPosition = {} as Position;

function makeExitCommand(reason: string): ExitCommand {
  return ExitCommand.of({
    positionId: PositionId.from('pos-1'),
    type: ExitType.TAKE_PROFIT,
    reason: ExitReason.of(reason),
  });
}

function ruleReturning(result: ExitCommand | DoNothing): ExitRule {
  return { shouldExit: vi.fn().mockReturnValue(result) };
}

describe('CompositeExitRule', () => {
  it('1つ目 DoNothing → 2つ目 ExitCommand → 2つ目が返る', () => {
    const cmd = makeExitCommand('2つ目の決済');
    const composite = new CompositeExitRule([
      ruleReturning(DoNothing.instance),
      ruleReturning(cmd),
    ]);
    const result = composite.shouldExit(dummySnapshot, dummyPosition);
    expect(result).toBe(cmd);
  });

  it('全て DoNothing → DoNothing が返る', () => {
    const composite = new CompositeExitRule([
      ruleReturning(DoNothing.instance),
      ruleReturning(DoNothing.instance),
    ]);
    const result = composite.shouldExit(dummySnapshot, dummyPosition);
    expect(result).toBe(DoNothing.instance);
  });

  it('1つ目 ExitCommand → 2つ目は呼ばれない（短絡評価）', () => {
    const cmd = makeExitCommand('1つ目の決済');
    const secondRule = ruleReturning(DoNothing.instance);
    const composite = new CompositeExitRule([
      ruleReturning(cmd),
      secondRule,
    ]);
    composite.shouldExit(dummySnapshot, dummyPosition);
    expect(secondRule.shouldExit).not.toHaveBeenCalled();
  });

  it('空配列で例外', () => {
    expect(() => new CompositeExitRule([])).toThrow('0個');
  });
});
