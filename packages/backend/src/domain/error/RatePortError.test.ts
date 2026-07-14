import { describe, it, expect } from 'vitest';
import { RatePortError } from './RatePortError.js';
import { CurrencyPair } from '../market/CurrencyPair.js';

describe('RatePortError', () => {
  const PAIR = CurrencyPair('USD_JPY');

  describe('notYetAvailable()', () => {
    it('NOT_YET_AVAILABLE コードと通貨ペアを保持する', () => {
      // Given / When
      const err = RatePortError.notYetAvailable(PAIR);

      // Then
      expect(err.code).toBe('NOT_YET_AVAILABLE');
      expect(err.pair).toBe(PAIR);
      expect(err.message).toContain('USD_JPY');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('stale()', () => {
    it('STALE コードと age / maxAge をメッセージに含む', () => {
      // Given / When
      const err = RatePortError.stale(PAIR, 6000, 5000);

      // Then
      expect(err.code).toBe('STALE');
      expect(err.pair).toBe(PAIR);
      expect(err.message).toContain('age=6000ms');
      expect(err.message).toContain('max=5000ms');
    });
  });
});
