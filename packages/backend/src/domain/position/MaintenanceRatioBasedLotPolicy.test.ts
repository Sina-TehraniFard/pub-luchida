import { describe, it, expect } from 'vitest';
import { MaintenanceRatioBasedLotPolicy } from './MaintenanceRatioBasedLotPolicy.js';
import { LotDecisionInput } from './LotDecisionInput.js';
import { Lot } from './Lot.js';
import { MaintenanceRatio } from './MaintenanceRatio.js';
import { MarginRate } from './MarginRate.js';
import { Balance } from '../Balance.js';
import { Money } from '../Money.js';
import { Rate } from '../market/Rate.js';
import { CurrencyPair } from '../market/CurrencyPair.js';

const NOW = new Date('2026-01-01T00:00:00Z');

function decisionInput(args: {
  pair?: string;
  balanceJpy?: string;
  rate?: string;
  target?: string;
  marginRate?: string;
}): LotDecisionInput {
  const pair = CurrencyPair(args.pair ?? 'USD_JPY');
  return LotDecisionInput.of(
    pair,
    Balance.of(Money.jpy(args.balanceJpy ?? '100000')),
    Rate.of(args.rate ?? '150', pair, NOW),
    MaintenanceRatio.of(args.target ?? '1.4'),
    MarginRate.of(args.marginRate ?? '0.04'),
  );
}

describe('MaintenanceRatioBasedLotPolicy', () => {
  const policy = new MaintenanceRatioBasedLotPolicy();

  describe('decide()', () => {
    describe('基本ケース', () => {
      it('Balance=100,000 JPY / Rate=150 / target=1.4 / marginRate=0.04 → Lot=11,900', () => {
        // raw = 100000 / (1.4 × 150 × 0.04) = 11904.7619... → floor(/100)*100 = 11900
        expect(policy.decide(decisionInput({})).equals(Lot.of(11_900))).toBe(true);
      });

      it('目標維持率 150%・USD/JPY レート 130・資金 10万円 → Lot = 12,800', () => {
        // 旧 MarginBasedLotPolicy.test.ts の回帰ケースを移植。
        // raw = 100000 / (1.5 × 130 × 0.04) = 12820.51... → 12800
        const lot = policy.decide(decisionInput({ rate: '130', target: '1.5' }));
        expect(lot.toNumber()).toBe(12_800);
      });

      it('目標維持率 125% / Rate 130 / 資金 10万円 → Lot = 15,300', () => {
        // raw = 100000 / (1.25 × 130 × 0.04) = 15384.61... → 15300
        const lot = policy.decide(decisionInput({ rate: '130', target: '1.25' }));
        expect(lot.toNumber()).toBe(15_300);
      });

      it('資金 2 倍 → Lot もほぼ 2 倍（複利動作）', () => {
        const lot1 = policy.decide(decisionInput({ balanceJpy: '100000', rate: '130', target: '1.25' }));
        const lot2 = policy.decide(decisionInput({ balanceJpy: '200000', rate: '130', target: '1.25' }));
        expect(lot2.toNumber() / lot1.toNumber()).toBeCloseTo(2, 1);
      });

      it('レート 2 倍 → Lot はほぼ半分', () => {
        const lot1 = policy.decide(decisionInput({ rate: '100', target: '1.25' }));
        const lot2 = policy.decide(decisionInput({ rate: '200', target: '1.25' }));
        expect(lot1.toNumber() / lot2.toNumber()).toBeCloseTo(2, 1);
      });
    });

    describe('100 の倍数切り捨て', () => {
      it('Lot は常に 100 の倍数', () => {
        const lot = policy.decide(decisionInput({ rate: '130', target: '1.25' }));
        expect(lot.toNumber() % 100).toBe(0);
      });

      it('rawLot=12_899.93... → 100 の倍数直前で 12_800 に下方丸め', () => {
        // capital=193_499 / (1.5 × 160 × 0.0625) = 193_499 / 15 = 12_899.933... → 12_800
        const lot = policy.decide(decisionInput({
          balanceJpy: '193499',
          rate: '160',
          target: '1.5',
          marginRate: '0.0625',
        }));
        expect(lot.toNumber()).toBe(12_800);
      });

      it('rawLot=12_900 ちょうど → 12_900 のまま', () => {
        // capital=193_500 / 15 = 12_900 (exact)
        const lot = policy.decide(decisionInput({
          balanceJpy: '193500',
          rate: '160',
          target: '1.5',
          marginRate: '0.0625',
        }));
        expect(lot.toNumber()).toBe(12_900);
      });
    });

    describe('クランプの境界値', () => {
      it('rounded = 100 ちょうど → 100 のまま（下限 inclusive）', () => {
        // capital = 100 × 1.25 × 130 × 0.04 = 650
        const lot = policy.decide(decisionInput({ balanceJpy: '650', rate: '130', target: '1.25' }));
        expect(lot.toNumber()).toBe(100);
      });

      it('rawLot < 100 → 下限 100 に持ち上がる', () => {
        const lot = policy.decide(decisionInput({ balanceJpy: '500', rate: '130', target: '1.25' }));
        expect(lot.toNumber()).toBe(100);
      });

      it('資金極小 (Balance=100 JPY) → 下限クランプで Lot=100', () => {
        const lot = policy.decide(decisionInput({ balanceJpy: '100' }));
        expect(lot.toNumber()).toBe(100);
      });

      it('rounded = SINGLE_LOT_MAX_UNITS ちょうど → 上限のまま', () => {
        // capital = 500_000 × 1.25 × 130 × 0.04 = 3_250_000
        const lot = policy.decide(decisionInput({ balanceJpy: '3250000', rate: '130', target: '1.25' }));
        expect(lot.toNumber()).toBe(Lot.SINGLE_LOT_MAX_UNITS);
      });

      it('rawLot > SINGLE_LOT_MAX_UNITS → 上限クランプ', () => {
        // 巨大残高 → SINGLE_LOT_MAX_UNITS にクランプ
        const lot = policy.decide(decisionInput({ balanceJpy: '10000000000', rate: '150', target: '1.4' }));
        expect(lot.toNumber()).toBe(Lot.SINGLE_LOT_MAX_UNITS);
      });
    });

    describe('JPY quote 制約', () => {
      it('非 JPY quote (EUR_USD) → JPY quote ペア専用エラー', () => {
        // EUR_USD は Balance も USD でないと LotDecisionInput.of で弾かれるので
        // policy.decide まで到達するルートを再現するには Balance を USD で組む必要がある
        const pair = CurrencyPair('EUR_USD');
        const input = LotDecisionInput.of(
          pair,
          Balance.of(Money.of('1000', 'USD')),
          Rate.of('1.1', pair, NOW),
          MaintenanceRatio.of('1.4'),
          MarginRate.of('0.04'),
        );
        expect(() => policy.decide(input)).toThrow(/JPY quote/);
      });

      it('EUR_JPY でも同じロジックで動く', () => {
        // raw = 100000 / (1.25 × 140 × 0.04) = 14285.71... → 14200
        const lot = policy.decide(decisionInput({ pair: 'EUR_JPY', rate: '140', target: '1.25' }));
        expect(lot.toNumber()).toBe(14_200);
      });

      it('GBP_JPY でも 0 より大きい Lot を返す', () => {
        const lot = policy.decide(decisionInput({ pair: 'GBP_JPY', rate: '170', target: '1.5' }));
        expect(lot.toNumber()).toBeGreaterThan(0);
      });
    });

    describe('Big 精度', () => {
      it('小数誤差が出ない（target × rate × marginRate に 0.1 を含む）', () => {
        // 0.1 + 0.2 != 0.3 のような JS Number 誤差が出るとずれる組み合わせ。
        // capital=100000 / (1.1 × 100 × 0.1) = 9090.909... → 9000
        const lot = policy.decide(decisionInput({
          balanceJpy: '100000',
          rate: '100',
          target: '1.1',
          marginRate: '0.1',
        }));
        expect(lot.toNumber()).toBe(9_000);
      });

      it('純関数: 同じ入力なら毎回同じ Lot', () => {
        const i = decisionInput({});
        expect(policy.decide(i).toNumber()).toBe(policy.decide(i).toNumber());
      });
    });
  });
});
