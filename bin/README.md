# bin/

`luchida` CLI（FX 自動売買 bot の運用・調査）。bot の起動・停止・再起動・ヘルスチェックに加え、調査・分析用の名前付きサブコマンドを束ねます。

## セットアップ

```bash
./bin/install.sh
source ~/.zshrc
```

`install.sh` が以下を実行します:

- `bin/luchida.sh` の実行権限を付与
- 依存ツール（`jq` / `python3` / `openssl` / `pm2` / `docker` / `psql` / `curl`）の存在確認
- `packages/backend/.env` の存在確認
- `~/.zshrc` に `alias luchida=...` を登録（未登録時のみ）
- `~/.zshrc` に `fpath` を追加して `bin/completions/_luchida` を zsh 補完に登録

## コマンド

### bot 運用（オプションフラグ）

- `luchida -s` — 安全な起動 + 起動後 HC（タイムアウト 15 秒、実測 cold start 約 2.2 秒）
- `luchida -e` — 停止（ポジションは決済せず GMO に保持。次回起動で bot が監視を再開）+ 停止後 HC（DB OPEN 件数 = GMO openPositions 件数の一致を照合）
- `luchida -r` — 最新 main を反映して再起動（`git fetch` → `main` を checkout → `origin/main` を `--ff-only` で pull → 停止 → 起動）。ローカルが本番のため、現在どのブランチにいても main を最新化してから再起動します。
  - **self-update 対応**: pull で `bin/luchida.sh` 自身が書き換わるため、pull 完了直後に `exec` で最新版の自分自身へプロセスを置き換えてから停止・起動を行います（古いスクリプトのまま停止・起動を続けない）。フェーズ制御は環境変数 `LUCHIDA_RESTART_PHASE` で行います
  - **停止の成否判定**: 「pm2 から `luchida-backend` が消えたか」をプロセス停止の成否基準とします。DB OPEN 件数と GMO openPositions 件数の照合は整合確認として行いますが、**不整合でも警告を出すだけで起動まで進みます**（再起動が目的なので bot を落としたままにしない）。`pm2 delete` 後もプロセスが残存している場合のみ本物の停止失敗として中止します
  - 最後に結果を1行で出力します:
    - 成功時: `再起動 完了: 最新 main を反映して起動しました。稼働バージョン v0.8.1 (a2b3c4d)`（差分なしの場合は `main に変更はありませんでした。…`）。exit 0
    - 失敗時: `再起動 失敗: 停止段階で中止しました…` または `…起動段階でヘルスチェックが通りませんでした…`。exit 非ゼロ
    - バージョンは root `package.json` の `version` と HEAD の短縮 commit hash を併記
- `luchida -c` — ヘルスチェック（独立実行）

### 調査・分析（名前付きサブコマンド）

- `luchida adx [--period N] [--bars N]` — 全通貨ペア × 各時間足の ADX/DI 一覧（トレンドの強さと向きを横断確認する参考表示。自動売買の判断には使用しません）
  - `--period N` — ADX/DI 期間（正の整数、既定 14）
  - `--bars N` — 各足で取得する確定足の本数（既定 200。period より十分多く取る）
  - klines は GMO の Public API のため API キー不要

### 保守（名前付きサブコマンド）

- `luchida update` — `git pull` で最新 CLI を取り込んだ後、シェルへの追従を反映します
  - エイリアスは `luchida.sh` を参照するだけなので pull で自動更新されますが、**zsh 補完の候補（新しいサブコマンドやオプション）は補完キャッシュ `~/.zcompdump` が古いと反映されません**。`luchida update` がこのキャッシュを再生成します（`_luchida` が更新されているときだけ。冪等）
  - 実行後は `source ~/.zshrc` か新規ターミナルで反映されます
  - 初回導入は `install.sh`、導入後の追従は `luchida update` と役割が分かれています

`luchida <TAB>` で zsh tab 補完が効きます（説明付きでオプション・サブコマンドが提示される。bot 運用フラグは排他、`adx` は続けて `--period` / `--bars` を補完）。

## 環境変数

`packages/backend/.env` から自動で読み込みます（bot 本体と同じファイル）。
コマンドライン側で指定した環境変数は `.env` の値より優先されます。

- `GMO_API_KEY` / `GMO_API_SECRET` — GMO FX API の認証情報
- `DATABASE_URL` — PostgreSQL 接続文字列

## 注意

`/api/health` は現状 `{ status: 'ok' }` を返すだけの表層的な実装で、以下を一切検知しません:

- WebSocket 切断
- SMA warmup 未完了
- DB connection pool 切断
- TradingSession 内部ループ停止

つまり「HC OK = bot が健全」とは言えません。改修は別 Issue で対応予定。

詳細仕様は [Issue #191](https://github.com/Sina-TehraniFard/luchida/issues/191) を参照。
