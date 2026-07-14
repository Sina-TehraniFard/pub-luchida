import { describe, it, expect } from 'vitest';
import { DoNothing } from './DoNothing.js';
import { ExitCommand, ExitType } from './ExitCommand.js';
import { ExitReason } from './ExitReason.js';
import { PositionId } from '../position/PositionId.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('DoNothing', () => {
  describe('シングルトン', () => {
    it('instance を2回取得すると同じインスタンスが返される', () => {
      // Given: 特に前提なし

      // When: instance を2回参照する
      const a = DoNothing.instance;
      const b = DoNothing.instance;

      // Then: 同一インスタンス（参照が同じ）
      expect(a).toBe(b);
    });
  });

  describe('型確認', () => {
    it('DoNothing.instance は DoNothing のインスタンスである', () => {
      // Given: 特に前提なし

      // When: instance を取得する
      const result = DoNothing.instance;

      // Then: DoNothing のインスタンスである
      expect(result).toBeInstanceOf(DoNothing);
    });

    it('DoNothing.instance は ExitCommand のインスタンスではない', () => {
      // Given: ExitCommand とは別の命令型として定義されている DoNothing

      // When: instance を取得する
      const result = DoNothing.instance;

      // Then: ExitCommand のインスタンスではない（ヌルオブジェクトとして独立した型）
      expect(result).not.toBeInstanceOf(ExitCommand);
    });
  });

  describe('ヌルオブジェクトとしての振る舞い', () => {
    it('ExitCommand と DoNothing は同一インスタンスではない', () => {
      // Given: ExitCommand と DoNothing
      const exitCommand = ExitCommand.of({
        positionId: PositionId.from(VALID_UUID),
        type: ExitType.TAKE_PROFIT,
        reason: ExitReason.of('利確ラインに到達'),
      });

      // When: DoNothing.instance と比較する
      const noop = DoNothing.instance;

      // Then: 別オブジェクトである
      expect(noop).not.toBe(exitCommand);
    });
  });
});
