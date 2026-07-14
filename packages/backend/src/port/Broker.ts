import { EntryCommand } from '../domain/command/EntryCommand.js';
import { Position } from '../domain/position/Position.js';
import { PositionId } from '../domain/position/PositionId.js';
import { EntryResult } from '../domain/market/EntryResult.js';
import { ExitResult } from '../domain/market/ExitResult.js';
import type { CurrencyPair } from '../domain/market/CurrencyPair.js';

/**
 * 注文発注・建玉照会の約束事。
 * エントリー注文・決済注文を FX 会社に送り、保有建玉を照会する。
 * 実装は adapter/gmo/GmoBrokerAdapter.ts が担う。
 */
export interface Broker {
  placeEntry(command: EntryCommand): Promise<EntryResult>;
  placeExit(position: Position): Promise<ExitResult>;

  /**
   * ブローカー側に現存する建玉の PositionId 一覧を返す。
   * SyncPositionsUseCase が DB との不一致検出（ブローカー側で決済済みの
   * ポジションを CLOSED に同期）に使う。
   * 設計書: docs/design/sequence/core/usecase-layer.md「建玉同期」
   */
  fetchOpenPositionIds(pair: CurrencyPair): Promise<readonly PositionId[]>;

  /**
   * 認証情報（API キー・シークレット）でブローカーと正しく繋がれることを確認する。
   * private API を 1 本叩き、認証ヘッダが受理されるか＝正しく結線されているかを検証する。
   * 「起動した」≠「正しい設定で起動した」を起動時に区別するための約束事。
   * 失敗時は原因別の BrokerError を throw する:
   *   - 認証失敗（鍵・署名不正）: BrokerError.authenticationFailed()
   *   - レート制限: BrokerError.rateLimited()
   *   - 通信断: BrokerError.networkError()
   *   - その他 API エラー: BrokerError.unexpected()
   * 起動時 fail-fast はどの失敗でも起動を中止するが、原因を区別することで
   * 運用者が打ち手を誤らない（正しい鍵を疑う等）ようにする。
   * 出典: #290（#287 の検知遅延 65 分）
   */
  verifyConnectivity(): Promise<void>;
}
