import { describe, it, expect } from 'vitest';
import { CurrencyPair } from '../market/CurrencyPair.js';
import { Balance } from '../Balance.js';
import { Money } from '../Money.js';
import { Rate } from '../market/Rate.js';
import { MaintenanceRatio } from './MaintenanceRatio.js';
import { MarginRate } from './MarginRate.js';
import { LotDecisionInput } from './LotDecisionInput.js';

describe('LotDecisionInput', () => {
  const usdJpy = CurrencyPair('USD_JPY');
  const eurJpy = CurrencyPair('EUR_JPY');
  const capturedAt = new Date('2026-05-02T00:00:00Z');

  const validBalance = (): Balance => Balance.of(Money.jpy(1_000_000));
  const validRate = (): Rate => Rate.of(150, usdJpy, capturedAt);
  const validTarget = (): MaintenanceRatio => MaintenanceRatio.of(1.4);
  const validMarginRate = (): MarginRate => MarginRate.of(0.04);

  describe('of()', () => {
    it('USD_JPY + JPY Balance + USD_JPY Rate + 目標維持率 + 証拠金率で生成成功する', () => {
      // Given: 通貨整合の取れた一式
      const pair = usdJpy;
      const balance = validBalance();
      const rate = validRate();
      const target = validTarget();
      const marginRate = validMarginRate();

      // When: of() で生成
      const input = LotDecisionInput.of(pair, balance, rate, target, marginRate);

      // Then: インスタンスが返り、各フィールドが取得できる
      expect(input).toBeInstanceOf(LotDecisionInput);
      expect(input.pair()).toBe(pair);
      expect(input.balance()).toBe(balance);
      expect(input.rate()).toBe(rate);
      expect(input.target()).toBe(target);
      expect(input.marginRate()).toBe(marginRate);
    });

    it('rate.pair() が input pair と一致しない場合は、エラーが投げられる', () => {
      // Given: input は USD_JPY だが Rate は EUR_JPY
      const rate = Rate.of(160, eurJpy, capturedAt);

      // When / Then: 通貨ペア不一致でエラー
      expect(() =>
        LotDecisionInput.of(
          usdJpy,
          validBalance(),
          rate,
          validTarget(),
          validMarginRate(),
        ),
      ).toThrow('Rate の通貨ペアが一致しません');
    });

    it('Balance の通貨が pair の quote 通貨と一致しない場合は、エラーが投げられる', () => {
      // Given: pair=USD_JPY（quote=JPY）に対して Balance を USD で渡す
      const usdBalance = Balance.of(Money.of(10_000, 'USD'));

      // When / Then: Balance 通貨と quote 通貨の不一致でエラー
      expect(() =>
        LotDecisionInput.of(
          usdJpy,
          usdBalance,
          validRate(),
          validTarget(),
          validMarginRate(),
        ),
      ).toThrow('Balance の通貨と Rate の quote 通貨が不一致');
    });

    it('rate.pair() と input pair が両方 EUR_JPY かつ Balance が JPY なら生成成功する', () => {
      // Given: USD_JPY 以外の JPY quote ペアでも整合していれば通る
      const pair = eurJpy;
      const rate = Rate.of(165, eurJpy, capturedAt);
      const balance = Balance.of(Money.jpy(500_000));

      // When: of() で生成
      const input = LotDecisionInput.of(
        pair,
        balance,
        rate,
        validTarget(),
        validMarginRate(),
      );

      // Then: 取得できる
      expect(input.pair()).toBe(pair);
      expect(input.rate()).toBe(rate);
      expect(input.balance()).toBe(balance);
    });
  });

  describe('pair() / balance() / rate() / target() / marginRate()', () => {
    it('各ゲッターで生成時に渡したインスタンスを取得できる', () => {
      // Given: 一式をそれぞれ別変数で保持
      const pair = usdJpy;
      const balance = validBalance();
      const rate = validRate();
      const target = validTarget();
      const marginRate = validMarginRate();
      const input = LotDecisionInput.of(pair, balance, rate, target, marginRate);

      // When / Then: 渡したインスタンスがそのまま取得できる
      expect(input.pair()).toBe(pair);
      expect(input.balance()).toBe(balance);
      expect(input.rate()).toBe(rate);
      expect(input.target()).toBe(target);
      expect(input.marginRate()).toBe(marginRate);
    });

    it('再度ゲッターを呼んでも同一インスタンスが返り、内部状態は差し替えできない', () => {
      // Given: 生成済み LotDecisionInput
      const input = LotDecisionInput.of(
        usdJpy,
        validBalance(),
        validRate(),
        validTarget(),
        validMarginRate(),
      );
      const balance1 = input.balance();
      const rate1 = input.rate();

      // When: 後から再度ゲッターを呼ぶ
      const balance2 = input.balance();
      const rate2 = input.rate();

      // Then: 同一インスタンスが返り続ける
      expect(balance1).toBe(balance2);
      expect(rate1).toBe(rate2);
    });
  });

  describe('equals()', () => {
    it('同一値で生成された 2 つは等価', () => {
      // Given: 同じ値で 2 つ生成
      const a = LotDecisionInput.of(
        usdJpy,
        validBalance(),
        validRate(),
        validTarget(),
        validMarginRate(),
      );
      const b = LotDecisionInput.of(
        usdJpy,
        validBalance(),
        validRate(),
        validTarget(),
        validMarginRate(),
      );

      // When / Then
      expect(a.equals(b)).toBe(true);
    });

    it('pair が異なれば非等価', () => {
      // Given: pair 違い
      const a = LotDecisionInput.of(
        usdJpy,
        validBalance(),
        validRate(),
        validTarget(),
        validMarginRate(),
      );
      const b = LotDecisionInput.of(
        eurJpy,
        validBalance(),
        Rate.of(165, eurJpy, capturedAt),
        validTarget(),
        validMarginRate(),
      );

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('balance が異なれば非等価', () => {
      // Given: balance 違い
      const a = LotDecisionInput.of(
        usdJpy,
        Balance.of(Money.jpy(1_000_000)),
        validRate(),
        validTarget(),
        validMarginRate(),
      );
      const b = LotDecisionInput.of(
        usdJpy,
        Balance.of(Money.jpy(2_000_000)),
        validRate(),
        validTarget(),
        validMarginRate(),
      );

      // When / Then
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('全フィールドが含まれる文字列を返す', () => {
      // Given: 標準値
      const input = LotDecisionInput.of(
        usdJpy,
        validBalance(),
        validRate(),
        validTarget(),
        validMarginRate(),
      );

      // When
      const s = input.toString();

      // Then
      expect(s.startsWith('LotDecisionInput(')).toBe(true);
      expect(s).toContain('pair=');
      expect(s).toContain('balance=');
      expect(s).toContain('rate=');
      expect(s).toContain('target=');
      expect(s).toContain('marginRate=');
    });
  });
});
