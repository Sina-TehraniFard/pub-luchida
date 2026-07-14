import { describe, it, expect } from 'vitest';
import { DetectedSignals } from './DetectedSignals.js';
import { StrategyName } from './StrategyName.js';

describe('DetectedSignals', () => {
  describe('of()', () => {
    it('戦略配列を渡すと DetectedSignals を生成する（contains は別経路生成でも strategyNameEquals 経由で true）', () => {
      // Given / When
      const ds = DetectedSignals.of([StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL]);
      // 定数ではなく factory 経由で生成（branded string ゆえ値が同じなら === 同一）
      const sameValue = StrategyName('SMA_CROSS');

      // Then
      expect(ds.size()).toBe(2);
      expect(ds.contains(StrategyName.SMA_CROSS)).toBe(true);
      expect(ds.contains(sameValue)).toBe(true);
      expect(ds.contains(StrategyName.RSI_REVERSAL)).toBe(true);
    });

    it('重複した戦略があるとエラーをスロー', () => {
      // Given / When / Then
      expect(() =>
        DetectedSignals.of([StrategyName.SMA_CROSS, StrategyName.SMA_CROSS]),
      ).toThrow(/重複した戦略/);
    });

    it('別経路生成の同戦略でも重複検出される（strategyNameEquals 経由）', () => {
      // Given: 定数ではなく factory 経由で生成（branded string ゆえ値が同じなら === 同一）
      const a = StrategyName('SMA_CROSS');
      const b = StrategyName('SMA_CROSS');

      // When / Then: 値が同じなら strategyNameEquals で重複扱い
      expect(() => DetectedSignals.of([a, b])).toThrow(/重複した戦略/);
    });

    it('空配列でも生成可能（empty 同等）', () => {
      // Given / When
      const ds = DetectedSignals.of([]);

      // Then
      expect(ds.isEmpty()).toBe(true);
      expect(ds.size()).toBe(0);
    });

    it('生成後に外部から要素を追加してもインスタンスは変わらない', () => {
      // Given
      const arr = [StrategyName.SMA_CROSS];
      const ds = DetectedSignals.of(arr);

      // When: 元配列に push しても
      arr.push(StrategyName.RSI_REVERSAL);

      // Then: 生成済みの DetectedSignals は影響を受けない
      expect(ds.size()).toBe(1);
    });
  });

  describe('empty()', () => {
    it('要素ゼロの DetectedSignals を返す', () => {
      // Given / When
      const ds = DetectedSignals.empty();

      // Then
      expect(ds.isEmpty()).toBe(true);
      expect(ds.size()).toBe(0);
      expect(ds.contains(StrategyName.SMA_CROSS)).toBe(false);
    });
  });

  describe('strategies()', () => {
    it('防御的コピーを返す（型 readonly のため push は型エラー、実体も独立配列）', () => {
      // Given
      const ds = DetectedSignals.of([StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL]);

      // When: strategies() を 2 回呼んでも参照は共有されない
      const copy1 = ds.strategies();
      const copy2 = ds.strategies();

      // Then: 別インスタンス（防御的コピー）
      expect(copy1).not.toBe(copy2);
      expect(copy1.length).toBe(2);
      expect(copy2.length).toBe(2);
      expect(ds.size()).toBe(2);
    });

    it('挿入順を保つ（残余寄せの末尾決定に影響するため）', () => {
      // Given / When
      const ds = DetectedSignals.of([
        StrategyName.WICK_REVERSAL,
        StrategyName.SMA_CROSS,
        StrategyName.RSI_REVERSAL,
      ]);

      // Then
      const order = ds.strategies().map((s) => s);
      expect(order).toEqual(['WICK_REVERSAL', 'SMA_CROSS', 'RSI_REVERSAL']);
    });
  });

  describe('equals()', () => {
    it('同じ戦略集合・同じ順序なら等価（別インスタンスでも StrategyName.equals 経由で true）', () => {
      // Given: a 側は of() で別インスタンス、b 側は静的シングルトン
      const a = DetectedSignals.of([StrategyName.of('SMA_CROSS'), StrategyName.of('RSI_REVERSAL')]);
      const b = DetectedSignals.of([StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL]);

      // When / Then: 参照同一性ではなく値比較で等価判定
      expect(a.equals(b)).toBe(true);
    });

    it('順序が違うと非等価（順序依存設計のため）', () => {
      // Given
      const a = DetectedSignals.of([StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL]);
      const b = DetectedSignals.of([StrategyName.RSI_REVERSAL, StrategyName.SMA_CROSS]);

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('要素数が違うと非等価', () => {
      // Given
      const a = DetectedSignals.of([StrategyName.SMA_CROSS]);
      const b = DetectedSignals.of([StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL]);

      // When / Then
      expect(a.equals(b)).toBe(false);
    });
  });
});
