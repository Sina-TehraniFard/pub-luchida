import { describe, it, expect } from 'vitest';
import { DiPlus, DiMinus } from './DiValue.js';

describe('DiPlus / DiMinus', () => {
  it('0–100 の範囲の値から生成できる', () => {
    expect(DiPlus.of('30.5').toString()).toBe('30.5');
    expect(DiMinus.of('0').toString()).toBe('0');
  });

  it('範囲外はエラー', () => {
    expect(() => DiPlus.of('-1')).toThrow('+DI は 0–100 の範囲');
    expect(() => DiMinus.of('100.5')).toThrow('−DI は 0–100 の範囲');
  });

  it('+DI が −DI を上回れば +DI が優勢', () => {
    const plus = DiPlus.of('30');
    const minus = DiMinus.of('10');
    expect(plus.isStrongerThan(minus)).toBe(true);
    expect(minus.isStrongerThan(plus)).toBe(false);
  });

  it('−DI が +DI を上回れば −DI が優勢', () => {
    const plus = DiPlus.of('10');
    const minus = DiMinus.of('30');
    expect(minus.isStrongerThan(plus)).toBe(true);
    expect(plus.isStrongerThan(minus)).toBe(false);
  });

  it('+DI と −DI が等しいときはどちらも優勢でない', () => {
    const plus = DiPlus.of('20');
    const minus = DiMinus.of('20');
    expect(plus.isStrongerThan(minus)).toBe(false);
    expect(minus.isStrongerThan(plus)).toBe(false);
  });

  it('toFixed は指定桁に丸める', () => {
    expect(DiPlus.of('30.456').toFixed(1)).toBe('30.5');
  });
});
