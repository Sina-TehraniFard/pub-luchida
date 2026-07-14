import type { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';

/**
 * エントリー判定の観測（繋ぎ用）。
 *
 * GC/DC の検知と各フィルタの通過/却下を1本のストリームとして外（UI）に流す。
 * 本番のエントリー判定ロジック（EntryRule デコレータ群）には一切干渉せず、
 * 同じ閾値で判定を再現して観測するだけ。フロントエンド撤去までの暫定。
 */
export interface EntryDecisionObserverPort {
  observe(snapshot: MarketSnapshot): void;
}

/** 何もしない観測器（テスト・観測不要構成の Null Object） */
export const NoopEntryDecisionObserver: EntryDecisionObserverPort = {
  observe(): void {},
};
