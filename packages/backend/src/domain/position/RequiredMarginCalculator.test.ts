import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Big from 'big.js';
import { requiredMarginAsJpy, requiredMarginBig } from './RequiredMarginCalculator.js';
import { Lot } from './Lot.js';
import { Rate } from '../market/Rate.js';
import { MarginRate } from './MarginRate.js';
import { Money } from '../Money.js';
import { CurrencyPair } from '../market/CurrencyPair.js';

const PAIR = CurrencyPair('USD_JPY');
const CAPTURED_AT = new Date('2026-05-08T00:00:00.000Z');

describe('RequiredMarginCalculator', () => {
  // Big.RM は global 設定。他テストが書き換えても本スイートが安定するよう保存・復元する。
  const originalRm = Big.RM;
  beforeEach(() => { Big.RM = Big.roundHalfUp; });
  afterEach(() => { Big.RM = originalRm; });


  describe('requiredMarginBig()', () => {
    it('rate × lot × marginRate を Big で返す', () => {
      // Given
      const result = requiredMarginBig(new Big('150'), new Big('1000'), new Big('0.04'));

      // Then: 150 × 1000 × 0.04 = 6000
      expect(result.toFixed()).toBe('6000');
    });

    it('Big の精度を保持する（小数の丸めをしない）', () => {
      // Given
      const result = requiredMarginBig(new Big('150.123'), new Big('100'), new Big('0.04'));

      // Then: 150.123 × 100 × 0.04 = 600.492
      expect(result.toFixed()).toBe('600.492');
    });
  });

  describe('requiredMarginAsJpy()', () => {
    it('JPY 整数化した Money を返す', () => {
      // Given
      const lot = Lot.of(1000);
      const rate = Rate.of('150', PAIR, CAPTURED_AT);
      const marginRate = MarginRate.of('0.04');

      // When
      const result = requiredMarginAsJpy(rate, lot, marginRate);

      // Then
      expect(result.equals(Money.jpy('6000'))).toBe(true);
    });

    it('小数部は toFixed(0) で 0.5 未満は切り捨てる', () => {
      // Given
      const lot = Lot.of(100);
      const rate = Rate.of('150.123', PAIR, CAPTURED_AT);
      const marginRate = MarginRate.of('0.04');

      // When: 150.123 × 100 × 0.04 = 600.492 → 600
      const result = requiredMarginAsJpy(rate, lot, marginRate);

      // Then
      expect(result.equals(Money.jpy('600'))).toBe(true);
    });

    it('0.5 境界は ROUND_HALF_UP で切り上げる（Big.js Big.RM=1 既定）', () => {
      // Given: 150.125 × 100 × 0.04 = 600.5（小数部ちょうど 0.5）
      const lot = Lot.of(100);
      const rate = Rate.of('150.125', PAIR, CAPTURED_AT);
      const marginRate = MarginRate.of('0.04');

      // When
      const result = requiredMarginAsJpy(rate, lot, marginRate);

      // Then: 601
      expect(result.equals(Money.jpy('601'))).toBe(true);
    });
  });

  describe('一貫性（NH-2 防御）', () => {
    it('Big 経路と Money 経路の整数部が一致する', () => {
      // Given
      const lot = Lot.of(1000);
      const rate = Rate.of('150', PAIR, CAPTURED_AT);
      const marginRate = MarginRate.of('0.04');

      // When
      const big = requiredMarginBig(rate.toBig(), new Big(lot.toNumber()), marginRate.toBig());
      const money = requiredMarginAsJpy(rate, lot, marginRate);

      // Then: 整数部が一致
      expect(money.equals(Money.jpy(big.toFixed(0)))).toBe(true);
    });
  });
});
