import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ResultStore } from './ResultStore.js';
import type { BacktestResult } from './BacktestResult.js';
import type { TradeRecord } from './TradeRecord.js';

/**
 * bt_runs + bt_trades への永続化実装。
 *
 * 1回の save() で bt_runs に1行 + bt_trades に N行を
 * 1トランザクションで INSERT する。immutable（UPDATE 禁止）。
 */
export class PostgresResultStore implements ResultStore {
  constructor(private readonly pool: Pool) {}

  async save(result: BacktestResult): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.insertRun(client, result);
      await this.insertTrades(client, result.id, result.trades);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  private async insertRun(client: PoolClient, r: BacktestResult): Promise<void> {
    await client.query(
      `INSERT INTO backtest.bt_runs (
        id, batch_id, strategy, pair, timeframe, params, date_from, date_to,
        initial_capital, engine_mode, execution_config,
        code_version, tick_count, bar_count, gap_count, data_hash, sample_type, fold_number,
        total_pnl, gross_profit, gross_loss, avg_pnl, avg_win, avg_loss,
        median_pnl, largest_win, largest_loss, payoff_ratio, profit_factor,
        expectancy_pips, pnl_per_day,
        trade_count, win_count, loss_count, win_rate,
        long_count, short_count, long_win_rate, short_win_rate, trades_per_month,
        max_drawdown, max_drawdown_pct, max_drawdown_duration_ms, avg_drawdown,
        calmar_ratio, recovery_factor, ulcer_index,
        pnl_stddev, sharpe_ratio, annualized_sharpe_ratio,
        sortino_ratio, annualized_sortino_ratio,
        sortino_standard, annualized_sortino_standard,
        sqn, sqn_capped,
        has_downside_risk, standard_metrics_computed,
        max_consecutive_wins, max_consecutive_losses,
        avg_mfe, avg_mae, mfe_efficiency,
        avg_holding_period_ms, status, ran_at, duration_ms
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
        $32,$33,$34,$35,$36,$37,$38,$39,$40,
        $41,$42,$43,$44,$45,$46,$47,
        $48,$49,$50,$51,$52,$53,$54,$55,$56,$57,
        $58,$59,$60,
        $61,$62,$63,$64,$65,$66,$67
      )`,
      [
        r.id, r.batchId, r.strategy, r.pair, r.timeframe,
        JSON.stringify(r.params), r.dateFrom, r.dateTo,
        r.initialCapital, r.engineMode,
        r.executionConfig ? JSON.stringify(r.executionConfig) : null,
        r.codeVersion, r.tickCount, r.barCount, r.gapCount, r.dataHash,
        r.sampleType, r.foldNumber,
        r.totalPnl, r.grossProfit, r.grossLoss, r.avgPnl, r.avgWin, r.avgLoss,
        r.medianPnl, r.largestWin, r.largestLoss, r.payoffRatio, r.profitFactor,
        r.expectancyPips, r.pnlPerDay,
        r.tradeCount, r.winCount, r.lossCount, r.winRate,
        r.longCount, r.shortCount, r.longWinRate, r.shortWinRate, r.tradesPerMonth,
        r.maxDrawdown, r.maxDrawdownPct, r.maxDrawdownDurationMs, r.avgDrawdown,
        r.calmarRatio, r.recoveryFactor, r.ulcerIndex,
        r.pnlStddev, r.sharpeRatio, r.annualizedSharpeRatio,
        r.sortinoRatio, r.annualizedSortinoRatio,
        r.sortinoStandard, r.annualizedSortinoStandard,
        r.sqn, r.sqnCapped,
        // 新規 run は標準指標を計算済み。has_downside_risk で番兵値 0 を判別可能にする。
        r.hasDownsideRisk, true,
        r.maxConsecutiveWins, r.maxConsecutiveLosses,
        r.avgMfe, r.avgMae, r.mfeEfficiency,
        Math.round(r.avgHoldingPeriodMs), r.status, r.ranAt, r.durationMs,
      ],
    );
  }

  private async insertTrades(client: PoolClient, runId: string, trades: ReadonlyArray<TradeRecord>): Promise<void> {
    if (trades.length === 0) return;

    const COLS_PER_ROW = 23;
    // PostgreSQL のパラメータ上限（65535）を超えないようにバッチ分割
    const BATCH_SIZE = Math.floor(65535 / COLS_PER_ROW);

    for (let offset = 0; offset < trades.length; offset += BATCH_SIZE) {
      const batch = trades.slice(offset, offset + BATCH_SIZE);
      const valueRows: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      for (const t of batch) {
        const placeholders = Array.from({ length: COLS_PER_ROW }, () => `$${idx++}`).join(',');
        valueRows.push(`(${placeholders})`);
        params.push(
          randomUUID(), runId, t.tradeSeq, t.side,
          t.entryTime, t.exitTime, t.entryPrice, t.exitPrice,
          t.lot, t.pnlPips, t.pnlAmount, t.capitalAtEntry,
          t.mfePips, t.mfeTime, t.maePips, t.maeTime,
          t.atrAtEntry, t.holdingPeriodMs, t.exitType,
          t.entryHourUtc, t.entryDayOfWeek,
          t.slippagePips, t.equityAfter,
        );
      }

      await client.query(
        `INSERT INTO backtest.bt_trades (
          id, run_id, trade_seq, side,
          entry_time, exit_time, entry_price, exit_price,
          lot, pnl_pips, pnl_amount, capital_at_entry,
          mfe_pips, mfe_time, mae_pips, mae_time,
          atr_at_entry, holding_period_ms, exit_type,
          entry_hour_utc, entry_day_of_week,
          slippage_pips, equity_after
        ) VALUES ${valueRows.join(',')}`,
        params,
      );
    }
  }
}
