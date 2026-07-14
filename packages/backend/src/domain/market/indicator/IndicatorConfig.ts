/**
 * テクニカル指標の設定。
 * どの指標を何期間で計算するかを表す値オブジェクト。
 * 戦略（Rule）側がこの設定を決め、TimeFrameBook に渡す。
 */
export class IndicatorConfig {
  private constructor(
    readonly shortSmaPeriod: number,
    readonly longSmaPeriod: number,
  ) {}

  static of(params: {
    shortSmaPeriod: number;
    longSmaPeriod: number;
  }): IndicatorConfig {
    if (params.shortSmaPeriod <= 0 || params.longSmaPeriod <= 0) {
      throw new Error('SMA 期間は正の整数でなければなりません');
    }
    if (params.shortSmaPeriod >= params.longSmaPeriod) {
      throw new Error(
        `短期SMA期間（${params.shortSmaPeriod}）は長期SMA期間（${params.longSmaPeriod}）より小さくなければなりません`,
      );
    }
    return new IndicatorConfig(params.shortSmaPeriod, params.longSmaPeriod);
  }
}
