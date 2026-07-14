import { pgTable, varchar, decimal, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const buySellType = pgEnum('buy_sell_type', ['BUY', 'SELL']);
export const positionStatus = pgEnum('position_status', ['OPEN', 'CLOSED']);

export const positions = pgTable('positions', {
  id: varchar('id', { length: 50 }).primaryKey(),
  currencyPair: varchar('currency_pair', { length: 7 }).notNull(),
  buySell: buySellType('buy_sell').notNull(),
  lot: decimal('lot', { precision: 10, scale: 2 }).notNull(),
  entryPrice: decimal('entry_price', { precision: 12, scale: 6 }).notNull(),
  exitPrice: decimal('exit_price', { precision: 12, scale: 6 }),
  profitLoss: decimal('profit_loss', { precision: 12, scale: 2 }),
  status: positionStatus('status').notNull().default('OPEN'),
  strategyName: varchar('strategy_name', { length: 50 }).notNull().default('SMA_CROSS'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  exitType: varchar('exit_type', { length: 20 }),
  exitReason: varchar('exit_reason', { length: 200 }),
  mfePips: decimal('mfe_pips', { precision: 10, scale: 4 }),
  maePips: decimal('mae_pips', { precision: 10, scale: 4 }),
});
