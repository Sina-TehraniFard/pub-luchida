/**
 * 市場データストリームのポート。
 * TradingSession（application層）が infrastructure の MarketDataStream に直接依存しないための境界。
 */
export interface MarketDataStreamPort {
  start(): Promise<void>;
  stop(): Promise<void>;
}
