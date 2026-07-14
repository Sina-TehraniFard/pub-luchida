import { Tick } from '../domain/market/tick/Tick.js';

/**
 * 市場データの受信窓口。
 * リアルタイムの tick を受け取るための購読インターフェース。
 * 具体的な実装は Adapter 層が担う。
 */
export interface MarketDataPort {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** tick を購読する。戻り値の関数を呼ぶと、この購読だけを解除できる。 */
  subscribe(onTick: (tick: Tick) => void): () => void;
}
