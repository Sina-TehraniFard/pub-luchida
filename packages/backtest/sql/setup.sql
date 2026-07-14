-- =============================================================
-- バックテスト用 TimescaleDB セットアップ
-- DBサーバ（<PRIVATE_IP> / Tailscale <PRIVATE_IP>）で実行
-- =============================================================

-- 1. TimescaleDB 拡張の有効化
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 2. ユーザーとデータベースの作成
-- ※ postgres ユーザーで実行
-- CREATE USER backtest WITH PASSWORD 'backtest_2026';
-- CREATE DATABASE tick_data OWNER backtest;
-- \c tick_data
-- CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 3. tick テーブル
CREATE TABLE IF NOT EXISTS fx_tick (
    time        TIMESTAMPTZ   NOT NULL,
    pair        TEXT          NOT NULL,
    bid         NUMERIC(12,6) NOT NULL,
    ask         NUMERIC(12,6) NOT NULL,
    bid_volume  NUMERIC,
    ask_volume  NUMERIC
);

-- 4. hypertable 化（TimescaleDB の核心）
SELECT create_hypertable('fx_tick', 'time', if_not_exists => TRUE);

-- 5. インデックス
CREATE INDEX IF NOT EXISTS idx_fx_tick_pair_time
    ON fx_tick (pair, time DESC);

-- 6. 圧縮ポリシー
ALTER TABLE fx_tick SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'pair',
    timescaledb.compress_orderby = 'time'
);
SELECT add_compression_policy('fx_tick', INTERVAL '7 days', if_not_exists => TRUE);

-- 7. ネットワーク接続許可（pg_hba.conf に手動で追加が必要）
-- host tick_data backtest 0.0.0.0/0 scram-sha-256
