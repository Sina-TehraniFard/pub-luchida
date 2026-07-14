import { describe, it, expect } from 'vitest';
import { TrendStrength } from './TrendStrength.js';
import { AdxValue } from './AdxValue.js';
import { DiPlus, DiMinus } from './DiValue.js';
import { TrendDirection } from './TrendDirection.js';

describe('TrendStrength', () => {
  it('+DI > −DI なら方向は UP', () => {
    const ts = TrendStrength.of({
      adx: AdxValue.of('30'),
      diPlus: DiPlus.of('28'),
      diMinus: DiMinus.of('12'),
    });
    expect(ts.direction()).toBe(TrendDirection.UP);
  });

  it('−DI > +DI なら方向は DOWN', () => {
    const ts = TrendStrength.of({
      adx: AdxValue.of('30'),
      diPlus: DiPlus.of('12'),
      diMinus: DiMinus.of('28'),
    });
    expect(ts.direction()).toBe(TrendDirection.DOWN);
  });

  it('+DI == −DI なら方向は NEUTRAL', () => {
    const ts = TrendStrength.of({
      adx: AdxValue.of('15'),
      diPlus: DiPlus.of('20'),
      diMinus: DiMinus.of('20'),
    });
    expect(ts.direction()).toBe(TrendDirection.NEUTRAL);
  });

  it('生成時の ADX/+DI/−DI を保持する', () => {
    const ts = TrendStrength.of({
      adx: AdxValue.of('42.3'),
      diPlus: DiPlus.of('25.1'),
      diMinus: DiMinus.of('9.8'),
    });
    expect(ts.adx.toString()).toBe('42.3');
    expect(ts.diPlus.toString()).toBe('25.1');
    expect(ts.diMinus.toString()).toBe('9.8');
  });
});
