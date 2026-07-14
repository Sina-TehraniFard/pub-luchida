import type { CurrencyPair } from '../domain/market/CurrencyPair.js';
import { Rate } from '../domain/market/Rate.js';

/**
 * 通貨ペアの最新レート取得の約束事。
 *
 * Rate の発生源は Tick（`MarketDataPort.subscribe` で配信される）。
 * `MarketDataStreamPort` はライフサイクル契約のため、最新値クエリは混ぜない。
 * 実装は `MarketDataPort.subscribe` を listener として購読する Tick-driven Adapter
 * （Tick → Rate へ最短経路で変換）。
 *
 * 両メソッドとも **同期**: Tick-driven のため I/O を伴わず、Rule 層を async 汚染
 * しないための設計判断（BalancePort.current と同じ方針）。
 *
 * 鮮度保証の有無で 2 メソッドを使い分ける:
 *   - `currentOf(pair)`: 鮮度非保証。初回 tick 未到着時は null
 *   - `currentFresh(pair)`: 鮮度保証。未到着・鮮度切れは `RatePortError` で throw
 *
 * 鮮度閾値（`maxAgeMillis`）は実装のコンストラクタで注入する（マジックナンバー化しない）。
 *
 * 実装が単一通貨ペアにバインドする場合、バインド外の pair 要求は
 * `RatePortError.pairMismatch` で throw する（複数ペア対応は registry を別途用意）。
 *
 * 設計書: docs/design/position-manager/policies.md 4.4 P6（増田亨判定）。
 */
export interface RatePort {
  /**
   * 指定通貨ペアの現在レートを返す。
   * 鮮度非保証。初回 tick 未到着時は null を返す。
   */
  currentOf(pair: CurrencyPair): Rate | null;

  /**
   * 指定通貨ペアの鮮度保証された現在レートを返す。
   * 未到着または鮮度切れの場合は `RatePortError` を throw する。
   */
  currentFresh(pair: CurrencyPair): Rate;
}
