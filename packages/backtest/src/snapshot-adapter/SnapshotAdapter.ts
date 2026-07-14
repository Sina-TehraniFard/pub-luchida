import type { ConfirmedCandle } from '@luchida/backend/domain/market/candle/ConfirmedCandle.js';
import type { Tick } from '@luchida/backend/domain/market/tick/Tick.js';
import type { Price } from '@luchida/backend/domain/market/Price.js';
import type { MarketSnapshot } from '@luchida/backend/domain/market/snapshot/MarketSnapshot.js';

/**
 * BT のデータを共有カーネルの MarketSnapshot に変換するインターフェース。
 *
 * 共有カーネルの Rule は MarketSnapshot を前提としている。
 * BT 側でこの変換を担うことで、Rule に変更を入れずに再利用できる。
 */
export interface SnapshotAdapter {
  /**
   * 初期化。warmup 足を含む確定足を渡す。
   * Engine のメインループ開始前に1回だけ呼ぶ。
   */
  warmUp(confirmedCandles: ReadonlyArray<ConfirmedCandle>): void;

  /**
   * 差分の確定足1本を追加して MarketSnapshot を構築する。
   * warmUp 後、足ごとに呼ぶ。
   */
  addCandleAndBuild(
    newCandle: ConfirmedCandle,
    latestTick: Tick,
    nextCandleOpen: Price,
  ): MarketSnapshot;
}
