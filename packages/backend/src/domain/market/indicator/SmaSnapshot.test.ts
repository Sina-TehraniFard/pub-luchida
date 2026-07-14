import { describe, it, expect } from 'vitest';
import { SmaValue } from './SmaValue.js';
import { SmaSnapshot } from './SmaSnapshot.js';

describe('SmaSnapshot', () => {
  describe('生成', () => {
    it('shortSma / longSma / previousShortSma / previousLongSma を正しく保持して生成される', () => {
      // Given: 短期・長期の現在値と前回値
      const shortSma = SmaValue.of('151.000');
      const longSma = SmaValue.of('150.000');
      const previousShortSma = SmaValue.of('150.500');
      const previousLongSma = SmaValue.of('149.500');

      // When: SmaSnapshot.of() で生成する
      const snapshot = SmaSnapshot.of({ shortSma, longSma, previousShortSma, previousLongSma });

      // Then: 各フィールドが正しく保持されていることを確認する
      expect(snapshot.shortSma.equals(shortSma)).toBe(true);
      expect(snapshot.longSma.equals(longSma)).toBe(true);
      expect(snapshot.previousShortSma.equals(previousShortSma)).toBe(true);
      expect(snapshot.previousLongSma.equals(previousLongSma)).toBe(true);
    });
  });

  describe('equals（同値性）', () => {
    it('全フィールドが等しいとき true', () => {
      // Given: 同じ値を持つ2つのスナップショット
      const a = SmaSnapshot.of({
        shortSma: SmaValue.of('151.000'),
        longSma: SmaValue.of('150.000'),
        previousShortSma: SmaValue.of('150.500'),
        previousLongSma: SmaValue.of('149.500'),
      });
      const b = SmaSnapshot.of({
        shortSma: SmaValue.of('151.000'),
        longSma: SmaValue.of('150.000'),
        previousShortSma: SmaValue.of('150.500'),
        previousLongSma: SmaValue.of('149.500'),
      });

      // When: equals() を呼ぶ
      const result = a.equals(b);

      // Then: 全フィールドが等しいので true
      expect(result).toBe(true);
    });

    it('shortSma だけが異なるとき false', () => {
      // Given: shortSma だけが異なる2つのスナップショット
      const a = SmaSnapshot.of({
        shortSma: SmaValue.of('151.000'),
        longSma: SmaValue.of('150.000'),
        previousShortSma: SmaValue.of('150.500'),
        previousLongSma: SmaValue.of('149.500'),
      });
      const b = SmaSnapshot.of({
        shortSma: SmaValue.of('152.000'),
        longSma: SmaValue.of('150.000'),
        previousShortSma: SmaValue.of('150.500'),
        previousLongSma: SmaValue.of('149.500'),
      });

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('longSma だけが異なるとき false', () => {
      // Given: longSma だけが異なる2つのスナップショット
      const a = SmaSnapshot.of({
        shortSma: SmaValue.of('151.000'),
        longSma: SmaValue.of('150.000'),
        previousShortSma: SmaValue.of('150.500'),
        previousLongSma: SmaValue.of('149.500'),
      });
      const b = SmaSnapshot.of({
        shortSma: SmaValue.of('151.000'),
        longSma: SmaValue.of('999.000'),
        previousShortSma: SmaValue.of('150.500'),
        previousLongSma: SmaValue.of('149.500'),
      });

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('previousShortSma だけが異なるとき false', () => {
      // Given
      const a = SmaSnapshot.of({
        shortSma: SmaValue.of('151.000'),
        longSma: SmaValue.of('150.000'),
        previousShortSma: SmaValue.of('150.500'),
        previousLongSma: SmaValue.of('149.500'),
      });
      const b = SmaSnapshot.of({
        shortSma: SmaValue.of('151.000'),
        longSma: SmaValue.of('150.000'),
        previousShortSma: SmaValue.of('999.000'),
        previousLongSma: SmaValue.of('149.500'),
      });

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('previousLongSma だけが異なるとき false', () => {
      // Given
      const a = SmaSnapshot.of({
        shortSma: SmaValue.of('151.000'),
        longSma: SmaValue.of('150.000'),
        previousShortSma: SmaValue.of('150.500'),
        previousLongSma: SmaValue.of('149.500'),
      });
      const b = SmaSnapshot.of({
        shortSma: SmaValue.of('151.000'),
        longSma: SmaValue.of('150.000'),
        previousShortSma: SmaValue.of('150.500'),
        previousLongSma: SmaValue.of('999.000'),
      });

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('自分自身と比較したとき true（自己同値性）', () => {
      // Given: 1つのスナップショット
      const a = SmaSnapshot.of({
        shortSma: SmaValue.of('151.000'),
        longSma: SmaValue.of('150.000'),
        previousShortSma: SmaValue.of('150.500'),
        previousLongSma: SmaValue.of('149.500'),
      });

      // When: 自己参照で equals() を呼ぶ
      const result = a.equals(a);

      // Then: 同一インスタンスなので true
      expect(result).toBe(true);
    });
  });
});
