import { describe, it, expect } from 'vitest';
import { DuplicatePositionError } from './DuplicatePositionError.js';
import { CurrencyPair } from '../market/CurrencyPair.js';
import { StrategyName } from '../rule/StrategyName.js';

const PAIR = CurrencyPair('USD_JPY');

describe('DuplicatePositionError', () => {
  describe('detectedByDomain()', () => {
    it('DOMAIN origin で生成し、pair / strategy を保持する', () => {
      // Given / When
      const err = DuplicatePositionError.detectedByDomain(PAIR, StrategyName.SMA_CROSS);

      // Then
      expect(err).toBeInstanceOf(DuplicatePositionError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('DuplicatePositionError');
      expect(err.pair).toBe(PAIR);
      expect(err.strategyName).toBe(StrategyName.SMA_CROSS);
      expect(err.origin).toBe('DOMAIN');
      expect(err.cause).toBeUndefined();
    });

    it('メッセージに pair・strategy を含める', () => {
      // Given / When
      const err = DuplicatePositionError.detectedByDomain(PAIR, StrategyName.SMA_CROSS);

      // Then
      expect(err.message).toContain('USD_JPY');
      expect(err.message).toContain('SMA_CROSS');
    });
  });

  describe('detectedByPersistence()', () => {
    it('PERSISTENCE origin で生成し、Error.cause を保持する（ES2022 標準経由）', () => {
      // Given
      const cause = new Error('duplicate key value violates unique constraint');

      // When
      const err = DuplicatePositionError.detectedByPersistence(
        PAIR,
        StrategyName.RSI_REVERSAL,
        cause,
      );

      // Then
      expect(err.origin).toBe('PERSISTENCE');
      expect(err.cause).toBe(cause);
      expect(err.pair).toBe(PAIR);
      expect(err.strategyName).toBe(StrategyName.RSI_REVERSAL);
    });

    it('cause なしでも生成可能', () => {
      // Given / When
      const err = DuplicatePositionError.detectedByPersistence(PAIR, StrategyName.WICK_REVERSAL);

      // Then
      expect(err.origin).toBe('PERSISTENCE');
      expect(err.cause).toBeUndefined();
    });
  });
});
