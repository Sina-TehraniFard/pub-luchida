import { describe, it, expect } from 'vitest';
import { AdxValue } from './AdxValue.js';

describe('AdxValue', () => {
  it('0–100 の範囲の値から生成できる', () => {
    expect(AdxValue.of('0').toString()).toBe('0');
    expect(AdxValue.of('25.4').toString()).toBe('25.4');
    expect(AdxValue.of('100').toString()).toBe('100');
  });

  it('範囲外はエラー', () => {
    expect(() => AdxValue.of('-0.1')).toThrow('ADX は 0–100 の範囲');
    expect(() => AdxValue.of('100.1')).toThrow('ADX は 0–100 の範囲');
  });

  it('toFixed は指定桁に丸める', () => {
    expect(AdxValue.of('33.456').toFixed(1)).toBe('33.5');
  });

  it('isWeakTrend は 20 未満で true（境界 20 は false）', () => {
    expect(AdxValue.of('19.9').isWeakTrend()).toBe(true);
    expect(AdxValue.of('20').isWeakTrend()).toBe(false);
    expect(AdxValue.of('0').isWeakTrend()).toBe(true);
  });

  it('isVeryStrongTrend は 40 以上で true（境界 40 は true）', () => {
    expect(AdxValue.of('39.9').isVeryStrongTrend()).toBe(false);
    expect(AdxValue.of('40').isVeryStrongTrend()).toBe(true);
    expect(AdxValue.of('100').isVeryStrongTrend()).toBe(true);
  });

  it('末尾ゼロ違いでも等価', () => {
    expect(AdxValue.of('25.50').equals(AdxValue.of('25.5'))).toBe(true);
    expect(AdxValue.of('25.5').equals(AdxValue.of('25.6'))).toBe(false);
  });
});
