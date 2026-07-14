import { MarketSnapshot } from '../market/snapshot/MarketSnapshot.js';
import { EntryCommand } from '../command/EntryCommand.js';
import { DoNothing } from '../command/DoNothing.js';

/**
 * エントリー判定ルールの約束事。
 * 市場の断面写真を受け取り、エントリーすべきかどうかを判断する。
 * 判断結果は EntryCommand（エントリーする）または DoNothing（何もしない）で返す。
 *
 * shouldEntry() はシグナルを返すだけ。実際の発注は TradingSession が自動で行う。
 */
export interface EntryRule {
  shouldEntry(snapshot: MarketSnapshot): EntryCommand | DoNothing;
}
