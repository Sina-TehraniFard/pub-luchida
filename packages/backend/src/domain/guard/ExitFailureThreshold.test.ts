import { describe, it, expect } from 'vitest';
import { ExitFailureThreshold } from './ExitFailureThreshold.js';

describe('ExitFailureThreshold', () => {
  it('1 以上の整数で生成できる', () => {
    expect(ExitFailureThreshold.of(1).toNumber()).toBe(1);
    expect(ExitFailureThreshold.of(25).toNumber()).toBe(25);
  });

  it('0 はエラー（初回失敗で即停止になり「連続」の意味を失う）', () => {
    expect(() => ExitFailureThreshold.of(0)).toThrow('1 以上の整数');
  });

  it('負数・小数・NaN はエラー', () => {
    expect(() => ExitFailureThreshold.of(-1)).toThrow('1 以上の整数');
    expect(() => ExitFailureThreshold.of(2.5)).toThrow('1 以上の整数');
    expect(() => ExitFailureThreshold.of(Number.NaN)).toThrow('1 以上の整数');
  });

  it('toString は数値文字列を返す', () => {
    expect(ExitFailureThreshold.of(5).toString()).toBe('5');
  });
});
