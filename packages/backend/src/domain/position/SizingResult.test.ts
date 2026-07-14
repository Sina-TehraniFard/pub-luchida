import { describe, it, expect } from 'vitest';
import { SizingResult } from './SizingResult.js';
import { Lot } from './Lot.js';
import { Rate } from '../market/Rate.js';
import { MarginRate } from './MarginRate.js';
import { Money } from '../Money.js';
import { CurrencyPair } from '../market/CurrencyPair.js';

describe('SizingResult', () => {
  const PAIR = CurrencyPair('USD_JPY');
  const CAPTURED_AT = new Date('2026-05-08T00:00:00.000Z');

  describe('of()', () => {
    it('lot × rate × marginRate を JPY 整数化した requiredMargin を保持する', () => {
      // Given: 1000 単位 × 150 円/USD × 0.04 = 6,000 JPY
      const lot = Lot.of(1000);
      const rate = Rate.of('150', PAIR, CAPTURED_AT);
      const marginRate = MarginRate.of('0.04');

      // When: SizingResult を生成
      const result = SizingResult.of(lot, rate, marginRate);

      // Then: requiredMargin が 6000 JPY
      expect(result.requiredMargin().equals(Money.jpy('6000'))).toBe(true);
    });

    it('小数点以下が出るケースでも JPY は整数に丸める（toFixed(0)）', () => {
      // Given: 100 単位 × 150.123 × 0.04 = 600.492 → 600 JPY
      const lot = Lot.of(100);
      const rate = Rate.of('150.123', PAIR, CAPTURED_AT);
      const marginRate = MarginRate.of('0.04');

      // When
      const result = SizingResult.of(lot, rate, marginRate);

      // Then: 整数化された 600
      expect(result.requiredMargin().equals(Money.jpy('600'))).toBe(true);
    });

    it('0.5 丸め境界（toFixed(0) の Big.js デフォルト = ROUND_HALF_UP）を pin', () => {
      // Given: 100 × 150.125 × 0.04 = 600.5（小数部ちょうど 0.5）
      const lot = Lot.of(100);
      const rate = Rate.of('150.125', PAIR, CAPTURED_AT);
      const marginRate = MarginRate.of('0.04');

      // When
      const result = SizingResult.of(lot, rate, marginRate);

      // Then: Big.js の toFixed(0) は ROUND_HALF_UP で 601
      expect(result.requiredMargin().equals(Money.jpy('601'))).toBe(true);
    });

    it('与えた lot / rate がそのまま保持される（NH-2: rate を閉じ込める）', () => {
      // Given
      const lot = Lot.of(500);
      const rate = Rate.of('149.5', PAIR, CAPTURED_AT);
      const marginRate = MarginRate.of('0.04');

      // When
      const result = SizingResult.of(lot, rate, marginRate);

      // Then
      expect(result.lot().equals(lot)).toBe(true);
      expect(result.rate().equals(rate)).toBe(true);
    });
  });

  describe('equals()', () => {
    it('同じ lot / rate / requiredMargin を持つ SizingResult は等価', () => {
      // Given
      const lot = Lot.of(1000);
      const rate = Rate.of('150', PAIR, CAPTURED_AT);
      const marginRate = MarginRate.of('0.04');
      const a = SizingResult.of(lot, rate, marginRate);
      const b = SizingResult.of(lot, rate, marginRate);

      // When / Then
      expect(a.equals(b)).toBe(true);
    });

    it('lot が異なる SizingResult は等価ではない', () => {
      // Given
      const rate = Rate.of('150', PAIR, CAPTURED_AT);
      const marginRate = MarginRate.of('0.04');
      const a = SizingResult.of(Lot.of(100), rate, marginRate);
      const b = SizingResult.of(Lot.of(200), rate, marginRate);

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('rate が異なる（同じレート値でも capturedAt が異なる）SizingResult は等価ではない', () => {
      // Given
      const lot = Lot.of(1000);
      const marginRate = MarginRate.of('0.04');
      const rateA = Rate.of('150', PAIR, CAPTURED_AT);
      const rateB = Rate.of('150', PAIR, new Date('2026-05-08T00:00:01.000Z'));
      const a = SizingResult.of(lot, rateA, marginRate);
      const b = SizingResult.of(lot, rateB, marginRate);

      // When / Then
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('lot / rate / requiredMargin をデバッグ可能な形式で出力する', () => {
      // Given
      const lot = Lot.of(1000);
      const rate = Rate.of('150', PAIR, CAPTURED_AT);
      const marginRate = MarginRate.of('0.04');
      const result = SizingResult.of(lot, rate, marginRate);

      // When
      const s = result.toString();

      // Then
      expect(s).toContain('lot=1000');
      expect(s).toContain('rate=150');
      expect(s).toContain('requiredMargin=6000 JPY');
    });
  });
});
