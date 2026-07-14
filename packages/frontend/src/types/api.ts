/** GET /api/positions のレスポンス要素 */
export interface PositionData {
  id: string
  pair: string
  side: string
  lot: string
  entryPrice: string
  openedAt: string
  status: string
}

/** GMO 公開 ticker API のレスポンス */
export interface GmoTickerData {
  ask: string
  bid: string
  symbol: string
  timestamp: string
}

/** GET /api/equity のレスポンス要素 */
export interface EquityPoint {
  date: string
  daily_pnl: string
  cumulative_pnl: string
}

/** 操作ログの1件 */
export interface LogEntry {
  timestamp: string
  message: string
  type: 'info' | 'success' | 'error'
}
