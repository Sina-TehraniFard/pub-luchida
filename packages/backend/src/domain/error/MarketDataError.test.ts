import { describe, it, expect } from 'vitest';
import { MarketDataError } from './MarketDataError.js';

describe('MarketDataError', () => {
  describe('connectionFailed()', () => {
    it('接続失敗エラーを生成する', () => {
      const error = MarketDataError.connectionFailed();

      expect(error).toBeInstanceOf(MarketDataError);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('CONNECTION_FAILED');
      expect(error.name).toBe('MarketDataError');
    });

    it('原因を保持する', () => {
      const cause = new Error('ECONNREFUSED');
      const error = MarketDataError.connectionFailed(cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe('disconnected()', () => {
    it('切断エラーを生成する', () => {
      const error = MarketDataError.disconnected();

      expect(error.code).toBe('DISCONNECTED');
    });
  });

  describe('subscriptionFailed()', () => {
    it('チャネル名をメッセージに含める', () => {
      const error = MarketDataError.subscriptionFailed('ticker');

      expect(error.code).toBe('SUBSCRIPTION_FAILED');
      expect(error.message).toContain('ticker');
    });
  });

  describe('fetchFailed()', () => {
    it('取得失敗エラーを生成する', () => {
      const error = MarketDataError.fetchFailed('klines API returned 500');

      expect(error.code).toBe('FETCH_FAILED');
      expect(error.message).toContain('klines');
    });
  });

  describe('unexpected()', () => {
    it('想定外エラーを生成する', () => {
      const error = MarketDataError.unexpected('予期しないデータ形式');

      expect(error.code).toBe('UNEXPECTED');
      expect(error.message).toBe('予期しないデータ形式');
    });
  });
});
