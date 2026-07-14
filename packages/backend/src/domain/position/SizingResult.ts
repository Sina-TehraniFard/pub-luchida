import { Money } from '../Money.js';
import { Rate } from '../market/Rate.js';
import { Lot } from './Lot.js';
import { MarginRate } from './MarginRate.js';
import { requiredMarginAsJpy } from './RequiredMarginCalculator.js';
import type { SizingResultLike } from './SizingResultLike.js';

/**
 * 本番経路の `PositionSizingService.executeWithFresh()` / `executeSizing()` の戻り値。
 *
 * 発注直前に決定した Lot・Rate・必要証拠金・MarginRate を 1 つに束ねる値オブジェクト。
 * `PositionManager` が同一 tick 内で `RatePort.currentFresh()` を 2 回呼ぶ事故、および
 * `MarginRate` を application 層で再注入する事故、の両方を防ぐ（NH-2 の核心）。
 *
 * 制約:
 *   - `requiredMargin = rate × lot × marginRate` で算出
 *   - `marginRate` は必ず保持（null 不可。バックテスト経路は別型 BacktestSizingResult を使う）
 *   - 生成後は変更不可（ゲッターのみ）
 *
 * 通貨ペアの整合（rate.pair() と Lot の対応）は呼び出し側
 * （`PositionSizingService` / `LotDecisionInput`）で保証される前提。
 *
 * 設計書: docs/design/value-objects.md SizingResult 章。
 */
export class SizingResult implements SizingResultLike {
  private constructor(
    private readonly lotValue: Lot,
    private readonly rateValue: Rate,
    private readonly requiredMarginValue: Money,
    private readonly marginRateValue: MarginRate,
  ) {}

  static of(lot: Lot, rate: Rate, marginRate: MarginRate): SizingResult {
    return new SizingResult(lot, rate, requiredMarginAsJpy(rate, lot, marginRate), marginRate);
  }

  lot(): Lot {
    return this.lotValue;
  }

  rate(): Rate {
    return this.rateValue;
  }

  requiredMargin(): Money {
    return this.requiredMarginValue;
  }

  /**
   * 別 Lot に対する必要証拠金を、本 SizingResult に閉じ込めた rate / marginRate で算出する。
   *
   * 用途: `AllocationPolicy` の `apply(baseLot)` で配分後の Lot が baseLot と異なる場合、
   * `PositionManager` が各戦略の最終 Lot に対する requiredMargin を再計算する
   * （NH-2: `MarginRate` を application 層に持たせない / requiredMargin 計算は SizingResult に集約）。
   *
   * バックテスト経路は本メソッドを呼ぶ場面がない（証拠金計算しない）ため、
   * 専用型 `BacktestSizingResult` には本メソッドを設けていない（型分離によるコンパイル時防御）。
   */
  requiredMarginFor(lot: Lot): Money {
    return requiredMarginAsJpy(this.rateValue, lot, this.marginRateValue);
  }

  equals(other: SizingResult): boolean {
    return this.lotValue.equals(other.lotValue)
      && this.rateValue.equals(other.rateValue)
      && this.requiredMarginValue.equals(other.requiredMarginValue)
      && this.marginRateValue.equals(other.marginRateValue);
  }

  toString(): string {
    return `SizingResult(lot=${this.lotValue}, rate=${this.rateValue.toBig().toFixed()}, requiredMargin=${this.requiredMarginValue})`;
  }
}
