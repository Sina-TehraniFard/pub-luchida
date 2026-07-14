import { describe, it, expect } from 'vitest';
import { BacktestSizingResult } from './BacktestSizingResult.js';
import { Lot } from './Lot.js';
import { Money } from '../Money.js';
import { CurrencyPair } from '../market/CurrencyPair.js';

const PAIR = CurrencyPair('USD_JPY');

describe('BacktestSizingResult', () => {
  describe('of()', () => {
    it('lot を保持する', () => {
      // Given / When
      const result = BacktestSizingResult.of(Lot.of(1000), PAIR);

      // Then
      expect(result.lot().toNumber()).toBe(1000);
    });

    it('requiredMargin は常に 0 円', () => {
      // Given / When
      const result = BacktestSizingResult.of(Lot.of(1000), PAIR);

      // Then
      expect(result.requiredMargin().equals(Money.jpy('0'))).toBe(true);
    });

    it('rate はダミー値（1）で構築される', () => {
      // Given / When
      const result = BacktestSizingResult.of(Lot.of(1000), PAIR);

      // Then: 中身は使われないが Rate 型を満たす
      expect(result.rate().toBig().toNumber()).toBe(1);
    });
  });

  describe('型安全（コンパイル時防御）', () => {
    it('requiredMarginFor を持たない（SizingResult との型分離 / 設計憲法 6.7）', () => {
      // Given
      const result = BacktestSizingResult.of(Lot.of(1000), PAIR);

      // Then: requiredMarginFor メソッドが存在しないことを実行時にも確認
      // （TypeScript 上は型エラーで弾かれるので、ここは runtime 確認）
      expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result as any).requiredMarginFor,
      ).toBeUndefined();
    });
  });

  describe('equals()', () => {
    it('同じ lot で生成すれば等価', () => {
      // Given
      const a = BacktestSizingResult.of(Lot.of(1000), PAIR);
      const b = BacktestSizingResult.of(Lot.of(1000), PAIR);

      // When / Then
      expect(a.equals(b)).toBe(true);
    });

    it('lot が違えば非等価', () => {
      // Given
      const a = BacktestSizingResult.of(Lot.of(1000), PAIR);
      const b = BacktestSizingResult.of(Lot.of(2000), PAIR);

      // When / Then
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('lot を含む', () => {
      // Given
      const result = BacktestSizingResult.of(Lot.of(1000), PAIR);

      // When
      const s = result.toString();

      // Then
      expect(s).toContain('BacktestSizingResult');
      expect(s).toContain('lot=1000');
    });
  });
});
