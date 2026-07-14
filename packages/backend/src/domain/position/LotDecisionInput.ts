import { currencyPairEquals, quote, type CurrencyPair } from '../market/CurrencyPair.js';
import { Balance } from '../Balance.js';
import { Rate } from '../market/Rate.js';
import { MaintenanceRatio } from './MaintenanceRatio.js';
import { MarginRate } from './MarginRate.js';

/**
 * `LotPolicy.decide()` の呼び出しパラメータを束ねるパラメータオブジェクト。
 *
 * lot サイジング判断に必要な入力（通貨ペア、口座残高、現在レート、目標維持率、証拠金率）を
 * ひとまとめにする。引数の長大化を防ぎ、整合制約を生成時に強制するための値オブジェクト。
 *
 * 制約:
 *   - 全フィールド必須
 *   - `Rate` の通貨ペアが `pair` と一致すること
 *   - `Balance` の通貨が `pair` の quote 通貨と一致すること（JPY quote 前提では Balance も JPY）
 *
 * 生成後は変更不可（ゲッターのみ）。
 *
 * 設計書: docs/design/value-objects.md L1127-1178。
 */
export class LotDecisionInput {
  private constructor(
    private readonly pairValue: CurrencyPair,
    private readonly balanceValue: Balance,
    private readonly rateValue: Rate,
    private readonly targetValue: MaintenanceRatio,
    private readonly marginRateValue: MarginRate,
  ) {}

  static of(
    pair: CurrencyPair,
    balance: Balance,
    rate: Rate,
    target: MaintenanceRatio,
    marginRate: MarginRate,
  ): LotDecisionInput {
    if (!currencyPairEquals(rate.pair(), pair)) {
      throw new Error(
        `Rate の通貨ペアが一致しません: input=${pair} rate=${rate.pair()}`,
      );
    }
    const quoteCurrency = quote(pair);
    const balanceCurrency = balance.toMoney().currencyCode();
    if (balanceCurrency !== quoteCurrency) {
      throw new Error(
        `Balance の通貨と Rate の quote 通貨が不一致: balance=${balanceCurrency} quote=${quoteCurrency}`,
      );
    }
    return new LotDecisionInput(pair, balance, rate, target, marginRate);
  }

  pair(): CurrencyPair {
    return this.pairValue;
  }

  balance(): Balance {
    return this.balanceValue;
  }

  rate(): Rate {
    return this.rateValue;
  }

  target(): MaintenanceRatio {
    return this.targetValue;
  }

  marginRate(): MarginRate {
    return this.marginRateValue;
  }

  equals(other: LotDecisionInput): boolean {
    return currencyPairEquals(this.pairValue, other.pairValue)
      && this.balanceValue.equals(other.balanceValue)
      && this.rateValue.equals(other.rateValue)
      && this.targetValue.equals(other.targetValue)
      && this.marginRateValue.equals(other.marginRateValue);
  }

  toString(): string {
    return `LotDecisionInput(pair=${this.pairValue}, balance=${this.balanceValue}, rate=${this.rateValue.toBig().toFixed()}, target=${this.targetValue}, marginRate=${this.marginRateValue})`;
  }
}
