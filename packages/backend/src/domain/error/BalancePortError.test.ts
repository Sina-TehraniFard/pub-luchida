import { describe, it, expect } from 'vitest';
import { BalancePortError } from './BalancePortError.js';

describe('BalancePortError', () => {
  describe('apiFailed()', () => {
    it('API_FAILED コードと cause を保持する', () => {
      // Given
      const cause = new Error('GMO 500');

      // When
      const err = BalancePortError.apiFailed(cause);

      // Then
      expect(err.code).toBe('API_FAILED');
      expect(err.cause).toBe(cause);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('残高取得');
    });
  });

  describe('malformedResponse()', () => {
    it('MALFORMED_RESPONSE コードと理由をメッセージに含む', () => {
      // Given / When
      const err = BalancePortError.malformedResponse('balance フィールド欠落');

      // Then
      expect(err.code).toBe('MALFORMED_RESPONSE');
      expect(err.message).toContain('balance フィールド欠落');
    });
  });

  describe('unexpected()', () => {
    it('UNEXPECTED コードと任意メッセージを保持する', () => {
      // Given / When
      const err = BalancePortError.unexpected('想定外');

      // Then
      expect(err.code).toBe('UNEXPECTED');
      expect(err.message).toBe('想定外');
    });
  });
});
