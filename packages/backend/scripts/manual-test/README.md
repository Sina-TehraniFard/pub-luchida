# 手動テストスクリプト

packages/backend/ ディレクトリで実行すること。

## 入金不要（いつでも実行可能）

```bash
# 01: WebSocket ticker 受信（5件で停止）
node --env-file=.env --import tsx scripts/manual-test/01-ticker-receive.ts

# 02: ローソク足取得（1分足・1時間足・日足）
node --env-file=.env --import tsx scripts/manual-test/02-klines-fetch.ts

# 03: 建玉一覧取得（Private API 認証確認）
node --env-file=.env --import tsx scripts/manual-test/03-open-positions.ts
```

## 入金必須（実注文が発生する）

```bash
# 04: BUY 100通貨エントリー（ポジションが残る）
node --env-file=.env --import tsx scripts/manual-test/04-entry-buy.ts

# 05: 指定ポジションを決済（04の出力の positionId を渡す）
node --env-file=.env --import tsx scripts/manual-test/05-exit-position.ts <positionId>

# 06: エントリー → 即決済の往復（スプレッド分だけ損失）
node --env-file=.env --import tsx scripts/manual-test/06-entry-and-exit-roundtrip.ts
```
