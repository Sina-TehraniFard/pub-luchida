-- ============================================================
-- bt_runs に年率換算 Sharpe / Sortino カラムを追加
-- 実行: psql -h <host> -d tick_data -f 002_add_annualized_sharpe.sql
--
-- 背景: 既存の sharpe_ratio は per-trade スケール (avg / stddev)。
-- 機関標準との比較のため年率換算値 (per-trade × √(trades/year)) を併記する。
-- 既存レコードには 0 を入れる（互換のため NOT NULL）。必要なら再計算スクリプトで埋め直す。
-- ============================================================

ALTER TABLE backtest.bt_runs
  ADD COLUMN annualized_sharpe_ratio  NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN annualized_sortino_ratio NUMERIC(10,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN backtest.bt_runs.annualized_sharpe_ratio IS
  '年率換算 Sharpe = (avg_pnl/pnl_stddev) × √(trade_count / years)';
COMMENT ON COLUMN backtest.bt_runs.annualized_sortino_ratio IS
  '年率換算 Sortino = (avg_pnl/downside_stddev) × √(trade_count / years)';
