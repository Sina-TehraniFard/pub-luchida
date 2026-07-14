import { Price } from '@luchida/backend/domain/market/Price.js';
import { Pips } from '@luchida/backend/domain/market/Pips.js';
import type { BuySell } from '@luchida/backend/domain/market/BuySell.js';
import type { SeededRandom } from './SeededRandom.js';

/**
 * スリッページを正規分布でシミュレートする値オブジェクト。
 *
 * 1インスタンス = 1 pair。pipUnit をコンストラクタで固定して保持する。
 * 複数 pair を並行して走らせる場合は SlippageModelFactory 経由で解決する。
 *
 * 不利方向のみに適用: BT は保守的であるべきという設計方針による。
 * - BUY → 買い価格が上に滑る（不利）
 * - SELL → 売り価格が下に滑る（不利）
 */
export class SlippageModel {
  private readonly stddev: Pips;

  constructor(
    stddevPips: number,
    private readonly random: SeededRandom,
    private readonly pipUnit: number,
  ) {
    this.stddev = Pips.of(stddevPips.toString());
  }

  /**
   * スリッページを適用した約定価格を返す。
   *
   * 不利方向のみ（abs）なので常に |N(0,1)| * stddev の加算。
   */
  applyTo(basePrice: Price, buySell: BuySell): Price {
    const stddevNum = Number(this.stddev.toString());
    const slippage = Math.abs(this.random.nextGaussian()) * stddevNum * this.pipUnit;

    const base = Number(basePrice.toString());
    // BUY は価格上昇（不利）、SELL は価格下落（不利）
    const slippedPrice = buySell === 'BUY' ? base + slippage : base - slippage;

    // 価格が 0 以下になることを防ぐ。
    // toFixed(8) で USD ペア（0.0001 pip）のスリッページ精度も確保する。
    const safePrice = Math.max(slippedPrice, this.pipUnit);
    return Price.of(safePrice.toFixed(8));
  }
}
