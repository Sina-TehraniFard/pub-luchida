import { describe, it, expect } from 'vitest';
import { AuthFailureCount } from './AuthFailureCount.js';
import { AuthFailureThreshold } from './AuthFailureThreshold.js';

describe('AuthFailureCount', () => {
  it('zero() は 0 から始まる', () => {
    expect(AuthFailureCount.zero().toNumber()).toBe(0);
  });

  it('increment() は新インスタンスを返し、元を変えない（不変）', () => {
    const c0 = AuthFailureCount.zero();
    const c1 = c0.increment();
    expect(c0.toNumber()).toBe(0);
    expect(c1.toNumber()).toBe(1);
  });

  it('reset() は 0 に戻す', () => {
    const c = AuthFailureCount.zero().increment().increment();
    expect(c.toNumber()).toBe(2);
    expect(c.reset().toNumber()).toBe(0);
  });

  describe('reaches()', () => {
    const threshold = AuthFailureThreshold.of(3);

    it('閾値未満では false', () => {
      expect(AuthFailureCount.zero().increment().increment().reaches(threshold)).toBe(false);
    });

    it('閾値ちょうどで true', () => {
      const c = AuthFailureCount.zero().increment().increment().increment();
      expect(c.reaches(threshold)).toBe(true);
    });

    it('閾値超過でも true', () => {
      const c = AuthFailureCount.zero().increment().increment().increment().increment();
      expect(c.reaches(threshold)).toBe(true);
    });
  });
});

describe('AuthFailureThreshold', () => {
  it('1 以上の整数を受け入れる', () => {
    expect(AuthFailureThreshold.of(1).toNumber()).toBe(1);
    expect(AuthFailureThreshold.of(3).toNumber()).toBe(3);
  });

  it('0 以下は許容しない', () => {
    expect(() => AuthFailureThreshold.of(0)).toThrow();
    expect(() => AuthFailureThreshold.of(-1)).toThrow();
  });

  it('整数でない値は許容しない', () => {
    expect(() => AuthFailureThreshold.of(1.5)).toThrow();
  });
});
