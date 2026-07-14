import type { Pool } from 'pg';
import type { BatchStore, BatchInput, BatchStatus } from './BatchStore.js';

/**
 * bt_batches テーブルへの永続化実装。
 */
export class PostgresBatchStore implements BatchStore {
  constructor(private readonly pool: Pool) {}

  async create(batch: BatchInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO backtest.bt_batches (id, description, strategy, pair, timeframe, total_runs, status, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'RUNNING', NOW())`,
      [batch.batchId, batch.description, batch.strategy, batch.pair, batch.timeframe, batch.totalRuns],
    );
  }

  async complete(batchId: string, status: BatchStatus): Promise<void> {
    await this.pool.query(
      `UPDATE backtest.bt_batches
       SET status = $1, finished_at = NOW(),
           completed_runs = (SELECT COUNT(*) FROM backtest.bt_runs WHERE batch_id = $2)
       WHERE id = $2`,
      [status, batchId],
    );
  }
}
