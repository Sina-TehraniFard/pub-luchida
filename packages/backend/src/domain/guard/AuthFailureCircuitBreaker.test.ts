import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthFailureCircuitBreaker } from './AuthFailureCircuitBreaker.js';
import { AuthFailureThreshold } from './AuthFailureThreshold.js';
import { AuthAttemptOutcome } from './AuthAttemptOutcome.js';
import type { LogPort } from '../port/LogPort.js';

const mockLog = (): LogPort => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const FAILED = AuthAttemptOutcome.failed();
const SUCCEEDED = AuthAttemptOutcome.succeeded();

describe('AuthFailureCircuitBreaker', () => {
  let log: LogPort;
  let breaker: AuthFailureCircuitBreaker;

  beforeEach(() => {
    log = mockLog();
    // 閾値 3 で固定（本番 main.ts の初期値と一致）
    breaker = new AuthFailureCircuitBreaker(AuthFailureThreshold.of(3), log);
  });

  describe('初期状態', () => {
    it('起動直後は CLOSED（新規エントリー許可）', () => {
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.admitEntry().isBlocked()).toBe(false);
    });
  });

  describe('連続失敗での発動（CLOSED → OPEN）', () => {
    it('閾値未満（2 回）では抑止しない', () => {
      breaker.report(FAILED);
      breaker.report(FAILED);
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.admitEntry().isBlocked()).toBe(false);
    });

    it('連続 3 回で抑止に転じる', () => {
      breaker.report(FAILED);
      breaker.report(FAILED);
      breaker.report(FAILED);
      expect(breaker.isOpen()).toBe(true);
      const admission = breaker.admitEntry();
      expect(admission.isBlocked()).toBe(true);
      expect(admission.reasonLabel()).toBe('連続認証失敗');
    });

    it('発動した瞬間だけ warn ログを出す（連発しない）', () => {
      breaker.report(FAILED);
      breaker.report(FAILED);
      expect(log.warn).not.toHaveBeenCalled();
      breaker.report(FAILED); // ここで発動
      expect(log.warn).toHaveBeenCalledTimes(1);
      breaker.report(FAILED); // 既に OPEN。連発しない
      expect(log.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('連続の定義（間に成功を挟むとリセット）', () => {
    it('失敗 2 回の後に成功が入ると連続が途切れ、再び 3 回必要', () => {
      breaker.report(FAILED);
      breaker.report(FAILED);
      breaker.report(SUCCEEDED); // 連続が途切れる（count=0）
      breaker.report(FAILED);
      breaker.report(FAILED);
      expect(breaker.isOpen()).toBe(false); // まだ 2 回連続
      breaker.report(FAILED);
      expect(breaker.isOpen()).toBe(true); // ここで 3 回連続
    });

    it('CLOSED 中の成功報告では通知しない（状態不変）', () => {
      breaker.report(FAILED);
      breaker.report(SUCCEEDED);
      expect(log.info).not.toHaveBeenCalled();
      expect(log.warn).not.toHaveBeenCalled();
    });
  });

  describe('認証成功での自動復帰（OPEN → CLOSED）', () => {
    beforeEach(() => {
      // OPEN 状態にする
      breaker.report(FAILED);
      breaker.report(FAILED);
      breaker.report(FAILED);
    });

    it('1 回の成功で即 CLOSED に復帰し、新規エントリーを再び許可する', () => {
      expect(breaker.isOpen()).toBe(true);
      breaker.report(SUCCEEDED);
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.admitEntry().isBlocked()).toBe(false);
    });

    it('復帰した瞬間だけ info ログを出す', () => {
      breaker.report(SUCCEEDED); // 復帰
      expect(log.info).toHaveBeenCalledTimes(1);
    });

    it('OPEN 中の失敗継続では復帰通知も再発動通知も出さない', () => {
      vi.mocked(log.warn).mockClear();
      vi.mocked(log.info).mockClear();
      breaker.report(FAILED); // 既に OPEN。通知なし
      expect(log.warn).not.toHaveBeenCalled();
      expect(log.info).not.toHaveBeenCalled();
      expect(breaker.isOpen()).toBe(true);
    });
  });

  describe('閾値 1（発動を即時にする設定）', () => {
    it('1 回の失敗で即抑止', () => {
      const b = new AuthFailureCircuitBreaker(AuthFailureThreshold.of(1), mockLog());
      expect(b.isOpen()).toBe(false);
      b.report(FAILED);
      expect(b.isOpen()).toBe(true);
    });
  });
});
