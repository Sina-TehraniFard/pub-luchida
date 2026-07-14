import type { EntryRule } from '../EntryRule.js';
import type { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';
import type { EntryCommand } from '../../command/EntryCommand.js';
import { DoNothing } from '../../command/DoNothing.js';

/**
 * 時刻条件で inner EntryRule をブロックする汎用デコレータ。
 *
 * 登録された TimeWindow のいずれかが match する時刻では inner rule を呼ばず DoNothing を返す。
 * 用途例:
 *   - 流動性枯渇時間帯の回避
 *   - セッション切替ノイズの除去
 *   - 指標スパイク時刻の回避
 *
 * 本 Rule は機構だけを提供し、具体的な「どの時刻を block するか」の判断は
 * 呼び出し元（Composition Root）が TimeWindow の matches 関数で定義する。
 */
export class TimeWindowBlockEntryRule implements EntryRule {
  constructor(
    private readonly inner: EntryRule,
    private readonly windows: ReadonlyArray<TimeWindow>,
  ) {}

  shouldEntry(snapshot: MarketSnapshot): EntryCommand | DoNothing {
    const t = snapshot.capturedAt.toDate();
    for (const w of this.windows) {
      if (w.matches(t)) {
        return DoNothing.instance;
      }
    }
    return this.inner.shouldEntry(snapshot);
  }
}

/**
 * 時刻窓の定義。
 * matches(utcDate) が true を返す時刻で inner rule はブロックされる。
 *
 * 例:
 *   { label: '金曜 18:00-20:00 UTC', matches: (t) => t.getUTCDay()===5 && t.getUTCHours()>=18 && t.getUTCHours()<20 }
 */
export interface TimeWindow {
  readonly label: string;
  readonly matches: (utcTime: Date) => boolean;
}
