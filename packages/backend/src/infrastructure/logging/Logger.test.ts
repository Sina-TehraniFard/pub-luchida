import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from './Logger.js';
import type { LogEntry } from './Logger.js';

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('TestComponent');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const parseOutput = (mock: ReturnType<typeof vi.fn>): LogEntry =>
    JSON.parse(mock.mock.calls[0][0] as string) as LogEntry;

  describe('debug()', () => {
    it('LOG_LEVEL=INFO（デフォルト）では DEBUG は出力されない', () => {
      // When: debug メッセージを出力
      logger.debug('接続開始');

      // Then: console.log は呼ばれない（INFOレベル以上のみ出力）
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('info()', () => {
    it('INFO レベルで console.log に出力する', () => {
      logger.info('注文送信', { orderId: '123' });

      const entry = parseOutput(vi.mocked(console.log));
      expect(entry.level).toBe('INFO');
      expect(entry.message).toBe('注文送信');
      expect(entry.data).toEqual({ orderId: '123' });
    });
  });

  describe('warn()', () => {
    it('WARN レベルで console.warn に出力する', () => {
      logger.warn('レート制限に接近');

      const entry = parseOutput(vi.mocked(console.warn));
      expect(entry.level).toBe('WARN');
    });
  });

  describe('error()', () => {
    it('ERROR レベルで console.error に出力する', () => {
      logger.error('注文失敗', { code: 'ORDER_REJECTED' });

      const entry = parseOutput(vi.mocked(console.error));
      expect(entry.level).toBe('ERROR');
      expect(entry.data).toEqual({ code: 'ORDER_REJECTED' });
    });
  });

  describe('data なしの場合', () => {
    it('data フィールドが出力に含まれない', () => {
      logger.info('シンプルなメッセージ');

      const entry = parseOutput(vi.mocked(console.log));
      expect(entry).not.toHaveProperty('data');
    });
  });

  describe('timestamp', () => {
    it('UTC の Z 付き ISO ではなく JST 表示で出力する', () => {
      logger.info('時刻確認');

      const entry = parseOutput(vi.mocked(console.log));
      // YYYY-MM-DD HH:mm:ss.SSS 形式（オフセット・Z なし）
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
      expect(entry.timestamp).not.toContain('Z');
    });
  });

  describe('category', () => {
    it('未指定なら SYSTEM として出力する', () => {
      logger.info('カテゴリ未指定');

      const entry = parseOutput(vi.mocked(console.log));
      expect(entry.category).toBe('SYSTEM');
    });

    it('指定した category が出力に含まれる（UI タブ分けの軸）', () => {
      const tradeLogger = new Logger('TestComponent', 'TRADE');
      tradeLogger.info('エントリー判定');

      const entry = parseOutput(vi.mocked(console.log));
      expect(entry.category).toBe('TRADE');
    });
  });
});
