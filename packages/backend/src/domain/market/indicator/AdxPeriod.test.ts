import { describe, it, expect } from 'vitest';
import { AdxPeriod } from './AdxPeriod.js';

describe('AdxPeriod', () => {
  it('正の整数から生成できる', () => {
    expect(AdxPeriod.of(14).toNumber()).toBe(14);
    expect(AdxPeriod.of(1).toNumber()).toBe(1);
  });

  it('既定値は Wilder 標準の 14', () => {
    expect(AdxPeriod.DEFAULT.toNumber()).toBe(14);
  });

  it('0 以下はエラー', () => {
    expect(() => AdxPeriod.of(0)).toThrow('ADX 期間は正の整数');
    expect(() => AdxPeriod.of(-3)).toThrow('ADX 期間は正の整数');
  });

  it('小数はエラー', () => {
    expect(() => AdxPeriod.of(14.5)).toThrow('ADX 期間は正の整数');
  });

  it('同じ期間どうしは等価', () => {
    expect(AdxPeriod.of(14).equals(AdxPeriod.of(14))).toBe(true);
    expect(AdxPeriod.of(14).equals(AdxPeriod.of(20))).toBe(false);
  });

  it('toString は数値文字列', () => {
    expect(AdxPeriod.of(28).toString()).toBe('28');
  });
});
