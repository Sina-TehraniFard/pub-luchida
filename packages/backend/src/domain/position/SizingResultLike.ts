import type { Lot } from './Lot.js';
import type { Rate } from '../market/Rate.js';
import type { Money } from '../Money.js';

/**
 * サイジング結果の共通契約。
 *
 * 本番経路の {@link SizingResult} とバックテスト経路の {@link BacktestSizingResult} の両方が実装する。
 * `requiredMarginFor(lot)` のような「本番でのみ意味を持つ」操作は本契約に含めない（型分離による安全保証）。
 *
 * 設計書: docs/design/value-objects.md SizingResult / BacktestSizingResult 章。
 */
export interface SizingResultLike {
  lot(): Lot;
  rate(): Rate;
  requiredMargin(): Money;
}
