import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { AuthFailureCircuitBreaker } from './AuthFailureCircuitBreaker.js';
import { AuthFailureThreshold } from './AuthFailureThreshold.js';
import { NoopLogPort } from '../port/NoopLogPort.js';

/**
 * #290 Step2 の最重要要件「Exit（決済）は絶対に止めない」の構造的保証テスト。
 *
 * 番人は「新規エントリーを止める手段（admitEntry）」しか持たず、
 * 「決済を止める手段（admitExit 等）」を一切持たない。
 * 止める手段が存在しなければ、止め間違えることもない（権限の不在による安全）。
 *
 * このテストは「手段の不在」を 2 方向から固定する:
 *   1. 番人に Exit を問う口（admitExit / shouldBlockExit 等）が生えていないこと
 *   2. Exit 経路（ExitDispatcher / ExitExecution）が番人・関門 port を一切参照しないこと
 */
const here = dirname(fileURLToPath(import.meta.url));
const backendSrc = resolve(here, '../..');

describe('Exit は番人に止められない（構造的保証 / #290 Step2）', () => {
  it('番人は Exit を問う口を持たない（admitEntry のみ）', () => {
    const breaker = new AuthFailureCircuitBreaker(
      AuthFailureThreshold.of(3),
      NoopLogPort,
    );
    // 公開メソッドは report / admitEntry / isOpen のみ。Exit を止める口は存在しない。
    const guard = breaker as unknown as Record<string, unknown>;
    expect(typeof guard.admitEntry).toBe('function');
    expect(guard.admitExit).toBeUndefined();
    expect(guard.shouldBlockExit).toBeUndefined();
    expect(guard.admitExitClose).toBeUndefined();
  });

  it('Exit 経路（ExitDispatcher / ExitExecution）は番人・関門 port を参照しない', () => {
    const exitFiles = [
      resolve(backendSrc, 'application/ExitDispatcher.ts'),
      resolve(backendSrc, 'action/ExitExecution.ts'),
    ];
    for (const file of exitFiles) {
      const src = readFileSync(file, 'utf-8');
      // 番人・関門に関する識別子が Exit 経路のソースに現れないこと
      expect(src).not.toContain('AuthFailureCircuitBreaker');
      expect(src).not.toContain('EntryAdmissionPort');
      expect(src).not.toContain('admitEntry');
    }
  });
});
