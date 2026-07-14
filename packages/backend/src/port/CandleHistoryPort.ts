import { ConfirmedCandle } from '../domain/market/candle/ConfirmedCandle.js';
import { TimeFrame } from '../domain/market/TimeFrame.js';

/**
 * 過去のローソク足取得の約束事。
 * 起動時に SMA 計算のウォームアップ用に使う。
 * 具体的な実装は Adapter 層が担う。
 */
export interface CandleHistoryPort {
  fetchRecent(timeFrame: TimeFrame, candleCount: number): Promise<ConfirmedCandle[]>;
}
