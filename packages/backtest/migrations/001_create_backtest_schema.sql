-- ============================================================
-- Luchida BT 結果保存スキーマ
-- tick_data DB 内の backtest スキーマに作成
-- 実行: psql -h <host> -d tick_data -f 001_create_backtest_schema.sql
-- ============================================================

CREATE SCHEMA IF NOT EXISTS backtest;

-- ------------------------------------------------------------
-- bt_batches: パラメータスイープ1回分
-- ------------------------------------------------------------
CREATE TABLE backtest.bt_batches (
  id              UUID        PRIMARY KEY,
  description     TEXT,
  strategy        TEXT        NOT NULL,
  pair            TEXT        NOT NULL,
  timeframe       TEXT        NOT NULL,
  total_runs      INT         NOT NULL,
  completed_runs  INT         NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'RUNNING',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- bt_runs: 1パラメータ = 1行の成績表
-- ------------------------------------------------------------
CREATE TABLE backtest.bt_runs (
  id                UUID        PRIMARY KEY,
  batch_id          UUID        NOT NULL REFERENCES backtest.bt_batches(id),
  strategy          TEXT        NOT NULL,
  pair              TEXT        NOT NULL,
  timeframe         TEXT        NOT NULL,
  params            JSONB       NOT NULL,
  params_hash       TEXT        GENERATED ALWAYS AS (md5(params::text)) STORED,
  date_from         TIMESTAMPTZ NOT NULL,
  date_to           TIMESTAMPTZ NOT NULL,
  initial_capital   NUMERIC(14,2) NOT NULL,
  engine_mode       TEXT        NOT NULL,
  execution_config  JSONB,

  -- 再現性・監査
  code_version      TEXT        NOT NULL,
  tick_count        INT,
  bar_count         INT,
  gap_count         INT         NOT NULL DEFAULT 0,
  data_hash         TEXT,
  sample_type       TEXT        NOT NULL DEFAULT 'FULL',
  fold_number       SMALLINT,

  -- 収益性
  total_pnl         NUMERIC(12,2) NOT NULL,
  gross_profit      NUMERIC(12,2) NOT NULL,
  gross_loss        NUMERIC(12,2) NOT NULL,
  avg_pnl           NUMERIC(10,4) NOT NULL,
  avg_win           NUMERIC(10,4) NOT NULL,
  avg_loss          NUMERIC(10,4) NOT NULL,
  median_pnl        NUMERIC(10,4) NOT NULL,
  largest_win       NUMERIC(10,4) NOT NULL,
  largest_loss      NUMERIC(10,4) NOT NULL,
  payoff_ratio      NUMERIC(8,4)  NOT NULL,
  profit_factor     NUMERIC(8,4)  NOT NULL,
  expectancy_pips   NUMERIC(10,4) NOT NULL,
  pnl_per_day       NUMERIC(10,4) NOT NULL,

  -- トレード数・勝率
  trade_count       INT         NOT NULL,
  win_count         INT         NOT NULL,
  loss_count        INT         NOT NULL,
  win_rate          NUMERIC(5,4) NOT NULL,
  long_count        INT         NOT NULL,
  short_count       INT         NOT NULL,
  long_win_rate     NUMERIC(5,4) NOT NULL,
  short_win_rate    NUMERIC(5,4) NOT NULL,
  trades_per_month  NUMERIC(8,2) NOT NULL,

  -- リスク
  max_drawdown              NUMERIC(12,2) NOT NULL,
  max_drawdown_pct          NUMERIC(7,4)  NOT NULL,
  max_drawdown_duration_ms  BIGINT        NOT NULL,
  avg_drawdown              NUMERIC(12,2) NOT NULL,
  calmar_ratio              NUMERIC(8,4)  NOT NULL,
  recovery_factor           NUMERIC(8,4)  NOT NULL,
  ulcer_index               NUMERIC(8,4)  NOT NULL,

  -- 安定性
  pnl_stddev                NUMERIC(10,4) NOT NULL,
  sharpe_ratio              NUMERIC(8,4)  NOT NULL,
  sortino_ratio             NUMERIC(8,4)  NOT NULL,
  sqn                       NUMERIC(8,4)  NOT NULL,
  max_consecutive_wins      INT           NOT NULL,
  max_consecutive_losses    INT           NOT NULL,

  -- MFE/MAE
  avg_mfe           NUMERIC(10,4) NOT NULL,
  avg_mae           NUMERIC(10,4) NOT NULL,
  mfe_efficiency    NUMERIC(7,4)  NOT NULL,

  -- 時間・メタ
  avg_holding_period_ms BIGINT  NOT NULL,
  status            TEXT        NOT NULL,
  ran_at            TIMESTAMPTZ NOT NULL,
  duration_ms       INT         NOT NULL,

  -- CHECK: sample_type と fold_number の整合性
  CONSTRAINT chk_sample_fold CHECK (
    (sample_type IN ('FULL', 'IN_SAMPLE', 'OUT_OF_SAMPLE') AND fold_number IS NULL)
    OR (sample_type = 'WALK_FORWARD' AND fold_number IS NOT NULL)
  )
);

-- ------------------------------------------------------------
-- bt_trades: トレード明細
-- ------------------------------------------------------------
CREATE TABLE backtest.bt_trades (
  id                UUID        PRIMARY KEY,
  run_id            UUID        NOT NULL REFERENCES backtest.bt_runs(id) ON DELETE CASCADE,
  trade_seq         INT         NOT NULL,
  side              TEXT        NOT NULL,
  entry_time        TIMESTAMPTZ NOT NULL,
  exit_time         TIMESTAMPTZ NOT NULL,
  entry_price       NUMERIC(12,5) NOT NULL,
  exit_price        NUMERIC(12,5) NOT NULL,
  lot               NUMERIC(10,2) NOT NULL,
  pnl_pips          NUMERIC(10,2) NOT NULL,
  pnl_amount        NUMERIC(12,2) NOT NULL,
  capital_at_entry  NUMERIC(14,2) NOT NULL,
  mfe_pips          NUMERIC(10,2) NOT NULL,
  mfe_time          TIMESTAMPTZ NOT NULL,
  mae_pips          NUMERIC(10,2) NOT NULL,
  mae_time          TIMESTAMPTZ NOT NULL,
  atr_at_entry      NUMERIC(10,5),
  holding_period_ms BIGINT      NOT NULL,
  exit_type         TEXT        NOT NULL,
  entry_hour_utc    SMALLINT    NOT NULL,
  entry_day_of_week SMALLINT    NOT NULL,
  slippage_pips     NUMERIC(6,2) NOT NULL DEFAULT 0,
  equity_after      NUMERIC(14,2) NOT NULL,

  UNIQUE (run_id, trade_seq)
);

-- ------------------------------------------------------------
-- インデックス
-- ------------------------------------------------------------
CREATE INDEX idx_bt_runs_batch_id ON backtest.bt_runs (batch_id);
CREATE INDEX idx_bt_runs_strategy_pair_sample ON backtest.bt_runs (strategy, pair, timeframe, sample_type);
CREATE INDEX idx_bt_runs_params ON backtest.bt_runs USING GIN (params);
CREATE INDEX idx_bt_runs_params_hash ON backtest.bt_runs (params_hash);
CREATE INDEX idx_bt_trades_run_id ON backtest.bt_trades (run_id);
CREATE INDEX idx_bt_trades_entry_time ON backtest.bt_trades (run_id, entry_time);

-- ------------------------------------------------------------
-- トリガー: bt_runs の strategy/pair/timeframe が bt_batches と一致することを検証
-- ------------------------------------------------------------
CREATE FUNCTION backtest.check_run_batch_consistency() RETURNS TRIGGER AS $$
BEGIN
  PERFORM 1 FROM backtest.bt_batches
  WHERE id = NEW.batch_id
    AND strategy = NEW.strategy
    AND pair = NEW.pair
    AND timeframe = NEW.timeframe;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bt_runs の strategy/pair/timeframe が bt_batches と不一致 (batch_id=%)', NEW.batch_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_run_batch
  BEFORE INSERT ON backtest.bt_runs
  FOR EACH ROW EXECUTE FUNCTION backtest.check_run_batch_consistency();
