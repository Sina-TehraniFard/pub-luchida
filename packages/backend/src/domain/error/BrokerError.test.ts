import { describe, it, expect } from 'vitest';
import { BrokerError } from './BrokerError.js';

describe('BrokerError', () => {
  describe('authenticationFailed()', () => {
    it('認証失敗エラーを生成する', () => {
      const error = BrokerError.authenticationFailed();

      expect(error).toBeInstanceOf(BrokerError);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('AUTHENTICATION_FAILED');
      expect(error.name).toBe('BrokerError');
      expect(error.message).toContain('認証');
    });

    it('原因を保持する', () => {
      const cause = new Error('401 Unauthorized');
      const error = BrokerError.authenticationFailed(cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe('orderRejected()', () => {
    it('拒否理由をメッセージに含める', () => {
      const error = BrokerError.orderRejected('証拠金不足');

      expect(error.code).toBe('ORDER_REJECTED');
      expect(error.message).toContain('証拠金不足');
    });
  });

  describe('executionTimeout()', () => {
    it('orderId をメッセージに含める', () => {
      const error = BrokerError.executionTimeout('12345');

      expect(error.code).toBe('EXECUTION_TIMEOUT');
      expect(error.message).toContain('12345');
    });
  });

  describe('rateLimited()', () => {
    it('レート制限エラーを生成する', () => {
      const error = BrokerError.rateLimited();

      expect(error.code).toBe('RATE_LIMITED');
    });
  });

  describe('networkError()', () => {
    it('通信エラーを生成する', () => {
      const cause = new TypeError('fetch failed');
      const error = BrokerError.networkError(cause);

      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.cause).toBe(cause);
    });
  });

  describe('unexpected()', () => {
    it('想定外エラーを生成する', () => {
      const error = BrokerError.unexpected('不明なエラー');

      expect(error.code).toBe('UNEXPECTED');
      expect(error.message).toBe('不明なエラー');
    });
  });

  describe('isAuthenticationFailure()', () => {
    it('認証失敗は true', () => {
      expect(BrokerError.authenticationFailed().isAuthenticationFailure()).toBe(true);
    });

    it('認証失敗以外は false', () => {
      expect(BrokerError.networkError().isAuthenticationFailure()).toBe(false);
      expect(BrokerError.rateLimited().isAuthenticationFailure()).toBe(false);
      expect(BrokerError.unexpected('x').isAuthenticationFailure()).toBe(false);
    });
  });
});
