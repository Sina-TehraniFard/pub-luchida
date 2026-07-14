import { Money } from '../Money.js';
import { Rate } from '../market/Rate.js';
import { CurrencyPair } from '../market/CurrencyPair.js';
import { Lot } from './Lot.js';
import type { SizingResultLike } from './SizingResultLike.js';

/**
 * バックテスト専用のサイジング結果。
 *
 * 本番経路の {@link SizingResult} と共通契約 {@link SizingResultLike} を実装するが、
 * **`MarginRate` を持たず、`requiredMarginFor(lot)` も持たない**。バックテストでは
 * 実際の証拠金チェックを行わないため、`requiredMargin` は 0 円固定。
 *
 * 型分離の目的（設計憲法 6.7 整合）:
 *   - 本型インスタンスに対して `requiredMarginFor(lot)` を呼ぶコードは **コンパイル時にエラー** になる
 *   - 「null マーカー + 実行時 throw」よりも型システムで安全保証する
 *   - 本番経路では `SizingResult`、backtest 経路では `BacktestSizingResult` が必ず使われる
 *
 * 設計書: docs/design/value-objects.md BacktestSizingResult 章。
 */
export class BacktestSizingResult implements SizingResultLike {
  private constructor(
    private readonly lotValue: Lot,
    private readonly rateValue: Rate,
  ) {}

  /**
   * バックテスト用ファクトリ。
   * `requiredMargin` は 0 円固定。`rate` はダミー値で構築する（lot / requiredMargin 計算には使われない）。
   */
  static of(lot: Lot, pair: CurrencyPair): BacktestSizingResult {
    const dummyRate = Rate.of('1', pair, new Date(0));
    return new BacktestSizingResult(lot, dummyRate);
  }

  lot(): Lot {
    return this.lotValue;
  }

  rate(): Rate {
    return this.rateValue;
  }

  requiredMargin(): Money {
    return Money.jpy('0');
  }

  equals(other: BacktestSizingResult): boolean {
    return this.lotValue.equals(other.lotValue)
      && this.rateValue.equals(other.rateValue);
  }

  toString(): string {
    return `BacktestSizingResult(lot=${this.lotValue}, rate=${this.rateValue.toBig().toFixed()})`;
  }
}
