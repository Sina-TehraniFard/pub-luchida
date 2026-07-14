import { MarketSnapshot } from '../market/snapshot/MarketSnapshot.js';
import { Position } from '../position/Position.js';
import { ExitCommand } from '../command/ExitCommand.js';
import { DoNothing } from '../command/DoNothing.js';

/**
 * 決済判定ルールの約束事。
 * 市場の断面写真と保有ポジションを受け取り、決済すべきかどうかを判断する。
 * 判断結果は ExitCommand（決済する）または DoNothing（何もしない）で返す。
 *
 * 決済は完全自動（条件成立→即執行）。
 * 実装は rules/ submodule（別リポ）に置く。
 */
export interface ExitRule {
  shouldExit(snapshot: MarketSnapshot, position: Position): ExitCommand | DoNothing;
}
