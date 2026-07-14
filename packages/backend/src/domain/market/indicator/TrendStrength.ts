import { AdxValue } from './AdxValue.js';
import { DiPlus, DiMinus } from './DiValue.js';
import { TrendDirection } from './TrendDirection.js';

interface TrendStrengthParams {
  adx: AdxValue;
  diPlus: DiPlus;
  diMinus: DiMinus;
}

/**
 * 1 つの通貨ペア × 時間足のトレンド強度を表す値オブジェクト。
 * ADX（強さ）と +DI/−DI（方向の勢い）をひとまとめにし、方向は DI の優劣から導く。
 *
 * 「いま参加すべきペアか」は人間が ADX と方向を見て総合判断する。本クラスは
 * 統合スコア化や売買判定は一切行わない（参考表示のためのデータ集約のみ）。
 */
export class TrendStrength {
  readonly adx: AdxValue;
  readonly diPlus: DiPlus;
  readonly diMinus: DiMinus;

  private constructor(params: TrendStrengthParams) {
    this.adx = params.adx;
    this.diPlus = params.diPlus;
    this.diMinus = params.diMinus;
  }

  static of(params: TrendStrengthParams): TrendStrength {
    return new TrendStrength(params);
  }

  /** +DI / −DI の優劣からトレンド方向を導く。 */
  direction(): TrendDirection {
    if (this.diPlus.isStrongerThan(this.diMinus)) {
      return TrendDirection.UP;
    }
    if (this.diMinus.isStrongerThan(this.diPlus)) {
      return TrendDirection.DOWN;
    }
    return TrendDirection.NEUTRAL;
  }
}
