import { describe, it, expect } from 'vitest';
import { ExitRuleRegistry } from './ExitRuleRegistry.js';
import { StrategyName } from './StrategyName.js';
import { MissingExitRuleError } from '../error/MissingExitRuleError.js';
import type { ExitRule } from './ExitRule.js';
import { DoNothing } from '../command/DoNothing.js';

function mockExitRule(): ExitRule {
  return {
    shouldExit: () => DoNothing.instance,
  };
}

describe('ExitRuleRegistry', () => {
  describe('of()', () => {
    it('戦略と ExitRule のペア配列からレジストリが構築される', () => {
      // Given: 1 戦略分のエントリ
      const sma = mockExitRule();

      // When: of() でレジストリを構築する
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, sma]]);

      // Then: has で登録が確認できる
      expect(registry.has(StrategyName.SMA_CROSS)).toBe(true);
    });

    it('同一戦略の重複登録は throw する（branded string の === 同値で検知）', () => {
      // Given: 同じ戦略名で異なる Rule を 2 つ用意（branded string ゆえ値が同じなら === 同一）
      const a = mockExitRule();
      const b = mockExitRule();
      const sma1 = StrategyName('SMA_CROSS');
      const sma2 = StrategyName('SMA_CROSS');

      // When / Then: 重複登録は throw
      expect(() => ExitRuleRegistry.of([[sma1, a], [sma2, b]])).toThrow(/重複登録/);
    });

    it('複数戦略のレジストリが構築できる', () => {
      // Given: 2 戦略分のエントリ
      const sma = mockExitRule();
      const rsi = mockExitRule();

      // When
      const registry = ExitRuleRegistry.of([
        [StrategyName.SMA_CROSS, sma],
        [StrategyName.RSI_REVERSAL, rsi],
      ]);

      // Then
      expect(registry.has(StrategyName.SMA_CROSS)).toBe(true);
      expect(registry.has(StrategyName.RSI_REVERSAL)).toBe(true);
    });

    it('空配列でも構築できる（空レジストリ）', () => {
      // Given / When
      const registry = ExitRuleRegistry.of([]);

      // Then: 何も登録されていない
      expect(registry.has(StrategyName.SMA_CROSS)).toBe(false);
      expect(registry.registeredStrategies().size).toBe(0);
    });
  });

  describe('findRule()', () => {
    it('登録済み戦略は対応する ExitRule を返す', () => {
      // Given
      const sma = mockExitRule();
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, sma]]);

      // When
      const rule = registry.findRule(StrategyName.SMA_CROSS);

      // Then
      expect(rule).toBe(sma);
    });

    it('未登録戦略は undefined を返す（throw しない）', () => {
      // Given: SMA_CROSS のみ登録
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, mockExitRule()]]);

      // When
      const rule = registry.findRule(StrategyName.RSI_REVERSAL);

      // Then
      expect(rule).toBeUndefined();
    });
  });

  describe('ruleFor()', () => {
    it('登録済み戦略は対応する ExitRule を返す', () => {
      // Given
      const sma = mockExitRule();
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, sma]]);

      // When
      const rule = registry.ruleFor(StrategyName.SMA_CROSS);

      // Then
      expect(rule).toBe(sma);
    });

    it('未登録戦略は MissingExitRuleError を throw する', () => {
      // Given: SMA_CROSS のみ登録
      const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, mockExitRule()]]);

      // When / Then: RSI_REVERSAL を要求すると throw
      expect(() => registry.ruleFor(StrategyName.RSI_REVERSAL)).toThrow(MissingExitRuleError);
    });

    it('throw された MissingExitRuleError には対象 strategy が入っている', () => {
      // Given
      const registry = ExitRuleRegistry.of([]);

      // When / Then
      try {
        registry.ruleFor(StrategyName.SMA_DISTANCE);
        expect.fail('throw されるべき');
      } catch (err) {
        expect(err).toBeInstanceOf(MissingExitRuleError);
        expect((err as MissingExitRuleError).strategyName).toBe('SMA_DISTANCE');
      }
    });
  });

  describe('registeredStrategies()', () => {
    it('登録済みの戦略名集合を返す', () => {
      // Given
      const registry = ExitRuleRegistry.of([
        [StrategyName.SMA_CROSS, mockExitRule()],
        [StrategyName.WICK_REVERSAL, mockExitRule()],
      ]);

      // When
      const strategies = registry.registeredStrategies();

      // Then
      expect(strategies.size).toBe(2);
      expect(strategies.has('SMA_CROSS')).toBe(true);
      expect(strategies.has('WICK_REVERSAL')).toBe(true);
    });
  });
});
