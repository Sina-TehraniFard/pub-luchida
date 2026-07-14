import { describe, it, expect } from 'vitest';
import { MissingExitRuleError } from './MissingExitRuleError.js';
import { StrategyName } from '../rule/StrategyName.js';

describe('MissingExitRuleError', () => {
  describe('notRegistered()', () => {
    it('指定した戦略名を含む Error が生成される', () => {
      // Given: SMA_CROSS 戦略
      const strategy = StrategyName.SMA_CROSS;

      // When: notRegistered() でエラーを生成する
      const err = MissingExitRuleError.notRegistered(strategy);

      // Then: Error 系の各フィールドが正しく設定される
      expect(err).toBeInstanceOf(MissingExitRuleError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('MissingExitRuleError');
      expect(err.message).toContain('SMA_CROSS');
      expect(err.strategyName).toBe(strategy);
    });

    it('throw / catch で型で識別できる', () => {
      // Given / When: throw して catch する
      let captured: unknown;
      try {
        throw MissingExitRuleError.notRegistered(StrategyName.RSI_REVERSAL);
      } catch (err) {
        captured = err;
      }

      // Then: instanceof で識別できる
      expect(captured).toBeInstanceOf(MissingExitRuleError);
      expect((captured as MissingExitRuleError).strategyName).toBe('RSI_REVERSAL');
    });
  });
});
