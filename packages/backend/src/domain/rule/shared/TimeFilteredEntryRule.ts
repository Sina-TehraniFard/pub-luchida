import { EntryCommand } from '../../command/EntryCommand.js';
import { DoNothing } from '../../command/DoNothing.js';
import type { EntryRule } from '../EntryRule.js';
import type { MarketSnapshot } from '../../market/snapshot/MarketSnapshot.js';

/**
 * 時間帯フィルタ付きエントリー判定。
 * 指定した UTC 時間帯ではエントリーしない。
 */
export class TimeFilteredEntryRule implements EntryRule {
  constructor(
    private readonly inner: EntryRule,
    private readonly excludeHoursUtc: ReadonlySet<number>,
  ) {}

  shouldEntry(snapshot: MarketSnapshot): EntryCommand | DoNothing {
    const hour = snapshot.capturedAt.toDate().getUTCHours();
    if (this.excludeHoursUtc.has(hour)) return DoNothing.instance;
    return this.inner.shouldEntry(snapshot);
  }
}
