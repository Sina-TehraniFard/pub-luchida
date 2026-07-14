# バックテスト用 DB スキーマ

## セットアップ

1. DBサーバに PostgreSQL 16 + TimescaleDB をインストール（Issue #59 参照）
2. `setup.sql` を postgres ユーザーで実行
3. `packages/backtest/.env` に接続情報を記載（`.env.example` 参照）

## テーブル定義

### fx_tick

| カラム | 型 | 説明 |
|---|---|---|
| time | TIMESTAMPTZ | tick の発生時刻（UTC） |
| pair | TEXT | 通貨ペア（例: 'USD_JPY'） |
| bid | NUMERIC(12,6) | bid 価格 |
| ask | NUMERIC(12,6) | ask 価格 |
| bid_volume | NUMERIC | bid 出来高（nullable） |
| ask_volume | NUMERIC | ask 出来高（nullable） |

TimescaleDB の hypertable として管理。`time` カラムで自動パーティション。

## 依存する TimescaleDB 関数

- `time_bucket(interval, timestamptz)` — 任意間隔の OHLC 集約
- `first(value, time)` / `last(value, time)` — 時系列の最初/最後の値
- `create_hypertable()` — テーブルの hypertable 化
- `add_compression_policy()` — 古いチャンクの自動圧縮

これらは全て `CREATE EXTENSION timescaledb` で有効になる。
