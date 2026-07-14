import type { Position } from '../domain/position/Position.js';
import type { PositionId } from '../domain/position/PositionId.js';
import type { OpenPositions } from '../domain/position/OpenPositions.js';
import type { EntrySnapshot } from '../domain/market/snapshot/EntrySnapshot.js';
import type { CurrencyPair } from '../domain/market/CurrencyPair.js';
import type { StrategyName } from '../domain/rule/StrategyName.js';

/**
 * ポジションの永続化の約束事。
 * 実装は infrastructure/database/PostgresPositionRepository.ts が担う。
 */
export interface PositionRepository {
  register(position: Position, entrySnapshot?: EntrySnapshot): Promise<void>;
  update(position: Position): Promise<void>;
  findById(id: PositionId): Promise<Position>;
  openPositions(): Promise<OpenPositions>;

  /**
   * 指定 pair × 指定 **`OPEN` 状態の** ポジションを 1 件返す。
   * 存在しなければ null。
   *
   * 重複ポジション抑制の防御階層（policies.md 2.6 / 2.7.3）における位置付け:
   * - 一次防御: `PositionManager` が同 tick で取得した `OpenPositions.holdsStrategyOnPair(pair, strategy)` の in-memory 判定（通常経路）
   * - **二次防御 (本メソッド)**: in-memory スナップショットが古い・並列起動・`Broker.syncPositionState` 後の再確認等で、DB の最新状態を読み直す用途
   * - 三次防御: DB 部分ユニーク制約（Step5 PR で導入予定）
   *
   * 注: 同条件で 2 件以上 OPEN は不変条件違反だが、DB 部分ユニーク制約導入前は
   * defensive に最初の 1 件を返す。制約導入後（Step5 PR）は 1 件確定。
   *
   * 注: 戻り値は OPEN 限定。将来 `PENDING` 状態を導入する場合（brief 改訂候補 P9）は
   * 別メソッド or オプション引数で OPEN/PENDING 両方を扱えるよう拡張する。
   */
  findOpenByPairAndStrategy(
    pair: CurrencyPair,
    strategy: StrategyName,
  ): Promise<Position | null>;

  /**
   * 指定ポジションを CLOSED に更新する（建玉同期専用）。
   *
   * ブローカー側で既に決済済みのポジションを DB に反映する用途。
   * 決済価格・損益（ExitResult）が得られないため、ドメインの
   * `Position.close()` を経由できず、ステータスのみを更新する。
   * 通常の決済フローでは使わず、必ず `update(position)` を使うこと。
   *
   * TODO: ブローカーの約定履歴から ExitResult を復元してドメイン経由
   * （Position.restore() + close()）に変更する（usecase-layer.md の改善項目）。
   */
  markClosed(id: PositionId): Promise<void>;
}
