import { pgTable, varchar, decimal, smallint } from 'drizzle-orm/pg-core';
import { positions } from './positions.js';

export const positionEntrySnapshots = pgTable('position_entry_snapshots', {
  positionId: varchar('position_id', { length: 50 })
    .primaryKey()
    .references(() => positions.id),
  convictionScore: decimal('conviction_score', { precision: 5, scale: 4 }),
  smaSpreadAtrRatio: decimal('sma_spread_atr_ratio', { precision: 10, scale: 6 }),
  adx: decimal('adx', { precision: 10, scale: 4 }),
  atrPips: decimal('atr_pips', { precision: 10, scale: 4 }),
  rsi: decimal('rsi', { precision: 10, scale: 4 }),
  spreadPips: decimal('spread_pips', { precision: 6, scale: 4 }),
  trendAlignment: smallint('trend_alignment'),
  entryHour: smallint('entry_hour'),
  entryDayOfWeek: smallint('entry_day_of_week'),
});
