/**
 * エントリー時点の市場スナップショット。
 * 判定時のインジケータ値やスプレッドを記録し、後から分析に使う。
 * Phase 1 では SMA関連の値のみ。Phase 2 で RSI/ADX/ATR 等を追加。
 */
export class EntrySnapshot {
  private constructor(
    readonly convictionScore: string,
    readonly spreadPips: string | null,
    readonly entryHour: number,
    readonly entryDayOfWeek: number,
    readonly smaSpreadAtrRatio: string | null,
    readonly adx: string | null,
    readonly atrPips: string | null,
    readonly rsi: string | null,
    readonly trendAlignment: number | null,
  ) {}

  static of(params: {
    convictionScore: string;
    spreadPips?: string | null;
    entryHour: number;
    entryDayOfWeek: number;
    smaSpreadAtrRatio?: string | null;
    adx?: string | null;
    atrPips?: string | null;
    rsi?: string | null;
    trendAlignment?: number | null;
  }): EntrySnapshot {
    return new EntrySnapshot(
      params.convictionScore,
      params.spreadPips ?? null,
      params.entryHour,
      params.entryDayOfWeek,
      params.smaSpreadAtrRatio ?? null,
      params.adx ?? null,
      params.atrPips ?? null,
      params.rsi ?? null,
      params.trendAlignment ?? null,
    );
  }
}
