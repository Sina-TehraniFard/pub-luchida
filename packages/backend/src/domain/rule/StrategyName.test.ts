import { describe, it, expect } from 'vitest';
import { StrategyName, strategyNameEquals } from './StrategyName.js';

describe('StrategyName', () => {
  it('有効な戦略名で生成できる', () => {
    expect(StrategyName('SMA_CROSS')).toBe('SMA_CROSS');
    expect(StrategyName('RSI_REVERSAL')).toBe('RSI_REVERSAL');
    expect(StrategyName('SMA_DISTANCE')).toBe('SMA_DISTANCE');
    expect(StrategyName('WICK_REVERSAL')).toBe('WICK_REVERSAL');
  });

  it('of() は Strategy() の別名として同じ値を返す', () => {
    expect(StrategyName.of('SMA_CROSS')).toBe('SMA_CROSS');
  });

  it('無効な戦略名でエラーが投げられる', () => {
    expect(() => StrategyName('INVALID')).toThrow('無効な戦略名');
    expect(() => StrategyName('')).toThrow('無効な戦略名');
  });

  it('静的定数が正しい値を持つ', () => {
    expect(StrategyName.SMA_CROSS).toBe('SMA_CROSS');
    expect(StrategyName.RSI_REVERSAL).toBe('RSI_REVERSAL');
    expect(StrategyName.SMA_DISTANCE).toBe('SMA_DISTANCE');
    expect(StrategyName.WICK_REVERSAL).toBe('WICK_REVERSAL');
  });

  // #130 の核心: branded string ゆえ毎回生成しても参照同一（===）が成り立つ
  it('同じ戦略名は別経路で生成しても === で同一', () => {
    expect(StrategyName('SMA_CROSS') === StrategyName('SMA_CROSS')).toBe(true);
    expect(StrategyName('SMA_CROSS') === StrategyName.SMA_CROSS).toBe(true);
  });

  it('strategyNameEquals が同値・非同値を正しく判定する', () => {
    expect(strategyNameEquals(StrategyName('SMA_CROSS'), StrategyName.SMA_CROSS)).toBe(true);
    expect(strategyNameEquals(StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL)).toBe(false);
  });

  // #130 の核心: Map のキーとして等価に機能する（class 実装では毎回 new で壊れていた）
  it('Map のキーとして安定に機能する', () => {
    const map = new Map<StrategyName, number>();
    map.set(StrategyName('SMA_CROSS'), 1);
    expect(map.get(StrategyName('SMA_CROSS'))).toBe(1);
    expect(map.get(StrategyName.SMA_CROSS)).toBe(1);
    expect(map.get(StrategyName('RSI_REVERSAL'))).toBeUndefined();
  });

  it('文字列としてそのまま使える', () => {
    expect(String(StrategyName.SMA_CROSS)).toBe('SMA_CROSS');
    expect(`${StrategyName.SMA_CROSS}`).toBe('SMA_CROSS');
  });
});
