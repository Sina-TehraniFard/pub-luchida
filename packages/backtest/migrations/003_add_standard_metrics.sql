-- ============================================================
-- bt_runs に業界標準定義の成績指標カラムを追加（#99）
-- 実行: psql -h <host> -d tick_data -f 003_add_standard_metrics.sql
--
-- 背景: 既存の sortino_ratio は閾値に mean を使う非標準実装、sqn は n キャップなし。
-- 原典定義（Sortino & Price 1994 / Van Tharp 2008）の値を新カラムとして併記する。
-- 既存カラムはリネーム・削除せず温存し、過去結果との互換性を保つ。
-- 既存レコードには 0 を入れる（互換のため NOT NULL）。必要なら再計算スクリプトで埋め直す。
-- ============================================================

ALTER TABLE backtest.bt_runs
  ADD COLUMN sortino_standard             NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN annualized_sortino_standard  NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN sqn_capped                   NUMERIC(8,4)  NOT NULL DEFAULT 0;

COMMENT ON COLUMN backtest.bt_runs.sortino_standard IS
  '業界標準 Sortino = avg_pnl / downside_deviation。閾値 MAR=0（Sortino & Price 1994）';
COMMENT ON COLUMN backtest.bt_runs.annualized_sortino_standard IS
  '年率換算した業界標準 Sortino = sortino_standard × √(trade_count / years)';
COMMENT ON COLUMN backtest.bt_runs.sqn_capped IS
  'Van Tharp 原典 SQN = (avg_pnl/pnl_stddev) × √min(trade_count, 100)。n を 100 でキャップ';
