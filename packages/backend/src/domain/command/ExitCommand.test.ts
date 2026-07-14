import { describe, it, expect } from 'vitest';
import { ExitCommand, ExitType } from './ExitCommand.js';
import { ExitReason } from './ExitReason.js';
import { PositionId } from '../position/PositionId.js';

const VALID_UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_B = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

describe('ExitCommand', () => {
  describe('生成（正常系）', () => {
    it('TAKE_PROFIT で ExitCommand が生成される', () => {
      // Given: 有効な PositionId と ExitReason
      const positionId = PositionId.from(VALID_UUID_A);
      const reason = ExitReason.of('利確ラインに到達');

      // When: ExitType.TAKE_PROFIT で of() を呼ぶ
      const command = ExitCommand.of({
        positionId,
        type: ExitType.TAKE_PROFIT,
        reason,
      });

      // Then: ExitCommand のインスタンスで type が TAKE_PROFIT
      expect(command).toBeInstanceOf(ExitCommand);
      expect(command.type).toBe(ExitType.TAKE_PROFIT);
    });

    it('STOP_LOSS で ExitCommand が生成される', () => {
      // Given: 有効な PositionId と ExitReason
      const positionId = PositionId.from(VALID_UUID_A);
      const reason = ExitReason.of('損切りラインに到達');

      // When: ExitType.STOP_LOSS で of() を呼ぶ
      const command = ExitCommand.of({
        positionId,
        type: ExitType.STOP_LOSS,
        reason,
      });

      // Then: ExitCommand のインスタンスで type が STOP_LOSS
      expect(command).toBeInstanceOf(ExitCommand);
      expect(command.type).toBe(ExitType.STOP_LOSS);
    });
  });

  describe('positionId の保持', () => {
    it('TAKE_PROFIT コマンドに positionId が保持される', () => {
      // Given: 有効な PositionId
      const positionId = PositionId.from(VALID_UUID_A);
      const reason = ExitReason.of('利確ラインに到達');

      // When: ExitType.TAKE_PROFIT で of() を呼ぶ
      const command = ExitCommand.of({
        positionId,
        type: ExitType.TAKE_PROFIT,
        reason,
      });

      // Then: 渡した positionId と等価な値が保持されている
      expect(command.positionId.equals(positionId)).toBe(true);
    });

    it('STOP_LOSS コマンドに positionId が保持される', () => {
      // Given: 有効な PositionId
      const positionId = PositionId.from(VALID_UUID_B);
      const reason = ExitReason.of('損切りラインに到達');

      // When: ExitType.STOP_LOSS で of() を呼ぶ
      const command = ExitCommand.of({
        positionId,
        type: ExitType.STOP_LOSS,
        reason,
      });

      // Then: 渡した positionId と等価な値が保持されている
      expect(command.positionId.equals(positionId)).toBe(true);
    });
  });

  describe('reason の保持', () => {
    it('reason が ExitReason として保持される（TAKE_PROFIT）', () => {
      // Given: ExitReason インスタンス
      const positionId = PositionId.from(VALID_UUID_A);
      const reason = ExitReason.of('SMAデッドクロス確認');

      // When: ExitCommand を生成する
      const command = ExitCommand.of({
        positionId,
        type: ExitType.TAKE_PROFIT,
        reason,
      });

      // Then: reason は ExitReason インスタンスとして保持され toString() で値を取得できる
      expect(command.reason).toBeInstanceOf(ExitReason);
      expect(command.reason.toString()).toBe('SMAデッドクロス確認');
    });

    it('reason が ExitReason として保持される（STOP_LOSS）', () => {
      // Given: ExitReason インスタンス
      const positionId = PositionId.from(VALID_UUID_A);
      const reason = ExitReason.of('損切りラインに到達');

      // When: ExitCommand を生成する
      const command = ExitCommand.of({
        positionId,
        type: ExitType.STOP_LOSS,
        reason,
      });

      // Then: reason は ExitReason インスタンスとして保持され toString() で値を取得できる
      expect(command.reason).toBeInstanceOf(ExitReason);
      expect(command.reason.toString()).toBe('損切りラインに到達');
    });
  });
});
