import { describe, it, expect } from 'vitest';
import { GmoApiError } from './GmoApiError.js';

describe('GmoApiError', () => {
  describe('isRateLimited()', () => {
    it('status=4 はレート制限と判定する', () => {
      const err = new GmoApiError(4, [{ message_code: 'ERR-5003', message_string: 'レート制限' }]);
      expect(err.isRateLimited()).toBe(true);
    });

    it('status=4 以外はレート制限ではない', () => {
      const err = new GmoApiError(1, [{ message_code: 'ERR-9999', message_string: 'その他' }]);
      expect(err.isRateLimited()).toBe(false);
    });
  });

  describe('isAuthenticationFailed()', () => {
    it('message_code に ERR-5012 を含めば認証失敗と判定する', () => {
      const err = new GmoApiError(5, [{ message_code: 'ERR-5012', message_string: '認証エラー' }]);
      expect(err.isAuthenticationFailed()).toBe(true);
    });

    it('認証系コードを含まなければ認証失敗ではない', () => {
      const err = new GmoApiError(4, [{ message_code: 'ERR-5003', message_string: 'レート制限' }]);
      expect(err.isAuthenticationFailed()).toBe(false);
    });

    it('メッセージが空なら認証失敗ではない', () => {
      const err = new GmoApiError(1, []);
      expect(err.isAuthenticationFailed()).toBe(false);
    });
  });
});
