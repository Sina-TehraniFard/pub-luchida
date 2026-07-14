#!/usr/bin/env bash
#
# luchida — FX 自動売買 bot の運用・調査 CLI
#
# 使い方:
#   bot 運用（オプションフラグ）:
#     luchida -s   安全な起動 + 起動後ヘルスチェック
#     luchida -e   停止（ポジションは保持。次回起動で監視再開）+ 停止後ヘルスチェック
#     luchida -r   最新 main を反映して再起動（pull → 停止 → 起動）
#     luchida -c   ヘルスチェック（独立実行）
#
#   調査・分析（名前付きサブコマンド）:
#     luchida adx [--period N] [--bars N]   全通貨ペア × 各時間足の ADX/DI 一覧
#
#   保守（名前付きサブコマンド）:
#     luchida update   pull 後に CLI 補完キャッシュを再生成して追従させる
#
# 詳細仕様: https://github.com/Sina-TehraniFard/luchida/issues/191

set -euo pipefail

readonly APP_NAME="luchida-backend"
readonly POSTGRES_CONTAINER="luchida-postgres"
readonly HEALTH_URL="http://localhost:7778/api/health"

# このスクリプト自身の位置からリポジトリルートを解決する。
# ecosystem.config.cjs の cwd 指定が相対パスのため、pm2 start は
# 必ずリポジトリルートから実行する必要がある。
# cd 失敗時の終了コードが readonly でマスクされないよう、代入と
# readonly 宣言を分離する (shellcheck SC2155)。
#
# 注意: 以降の readonly 変数は source 時にも実行される。同一シェルで
# 本スクリプトを 2 回 source すると readonly 再代入で失敗し、set -e で
# 中断する。bats はテスト毎にサブシェルで分離するため現状のテストでは
# 顕在化しないが、テストランナーを変える際はこの前提に注意すること。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly REPO_ROOT
readonly ECOSYSTEM_CONFIG="$REPO_ROOT/ecosystem.config.cjs"
readonly ENV_FILE="$REPO_ROOT/packages/backend/.env"
readonly SELF_SCRIPT="$SCRIPT_DIR/luchida.sh"

# bot 本体と同じ .env を読み込む。GMO_API_KEY / GMO_API_SECRET / DATABASE_URL
# などを CLI 側からも参照するため。
# 既にコマンドラインで指定された環境変数は上書きしない（CLI 優先）。
#
# 値の前後クォートは Node の --env-file と同様に剥がす（#287）。
# 剥がさないと「"xxx"」という壊れた API キーが export され、さらに
# --env-file は既存環境変数を上書きしないため、壊れた値のまま bot に届く。
#
# .env の書式規約: 単純な KEY=VALUE のみ（export プレフィックス・複数行値・
# インラインコメント・エスケープは禁止）。ここと Node --env-file の
# 2 つのパーサが同じファイルを読むため、解釈が割れる書式を持ち込まないこと。
#
# 値の正規化（CRLF 除去・前後クォート剥がし）を 1 行単位の純関数として切り出す。
# export という副作用から分離することで bats から単体検証できる（#291）。
normalize_env_value() {
  local value="$1"
  # CRLF 行末の \r を除去（\r が残るとクォート剥がしも値照合も壊れる）
  value="${value%$'\r'}"
  # 前後の対になったクォート（" または '）を1組だけ剥がす
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

# 指定された .env ファイルを読み、KEY=VALUE を export する。
# 既存の環境変数は上書きしない（CLI 優先）。ファイルが無ければ何もしない。
parse_env_file() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0
  local key value
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case "$key" in
      ''|\#*) continue ;;
    esac
    # 変数名として正当なキーのみ扱う（空白・記号の混入による export 事故防止）
    if ! [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi
    value="$(normalize_env_value "$value")"
    # 既に環境変数が定義されていれば .env の値で上書きしない
    if [ -z "${!key+x}" ]; then
      export "$key=$value"
    fi
  done < "$env_file"
}

usage() {
  cat <<'EOF'
Usage: luchida <command>

Bot operations:
  -s            safe start + post-start health check
  -e            stop (positions preserved; monitoring resumes on next start) + post-stop health check
  -r            restart on latest main (pull -> stop -> start)
  -c            health check (standalone)

Analysis:
  adx [opts]    ADX/DI overview for all currency pairs x timeframes
                  --period N   ADX/DI period (positive integer, default 14)
                  --bars N     candles fetched per timeframe (default 200)

Maintenance:
  update        refresh shell completion cache after pulling latest CLI
EOF
}

# 追加引数を取らないコマンド（bot 運用フラグ・update）の引数個数を検査する。
# 呼び出し側の引数個数（$#）を渡し、ちょうど1個でなければ usage を出して終了。
# 「このコマンドは追加引数を許さない」という規約を1箇所に集約する。
require_no_extra_args() {
  [ "$1" -eq 1 ] || { usage; exit 1; }
}

# pm2 jlist から luchida-backend の status を取り出す。
# プロセスがリストに無ければ空文字を返す。
pm2_status() {
  pm2 jlist 2>/dev/null \
    | jq -r --arg name "$APP_NAME" \
        '.[] | select(.name == $name) | .pm2_env.status // empty'
}

# /api/health を一発叩く。HTTP 200 かつ認証が failed でないこと（#290）。
# タイムアウト: connect 1 秒 / 全体 3 秒（HC ループで詰まらないため）。
# auth フィールド: ok / unknown は成功扱い、failed のみ失敗扱い。
#   - unknown は起動時認証チェック完了前の一瞬、または auth 未対応の旧 bot（後方互換で通す）。
#   - failed は壊れた API キーで起動した状態（#287）。fail-fast でサーバごと落ちるのが通常だが、
#     万一 200 を返したまま failed になっているケースをここで検知する。
#   - 本文が壊れた JSON（不正レスポンス）は失敗扱い。auth 欠落の旧 bot とは区別する
#     （200 を返すのに本文が壊れているのは異常状態なので通さない）。
_curl_health() {
  local body raw_body http_code auth
  # %{http_code} を本文末尾に連結して取得し、両者を分離する。
  body=$(curl -s -w '\n%{http_code}' \
    --max-time 3 --connect-timeout 1 "$HEALTH_URL" || true)
  http_code=$(printf '%s' "$body" | tail -n1)
  [ "$http_code" = "200" ] || return 1

  # jq -e: パース失敗または出力が null/false なら非ゼロ終了。
  # `// "unknown"` で auth 欠落は "unknown" を出力するため旧 bot は通り、
  # 壊れた JSON はパース失敗で return 1（不正レスポンスを弾く）。
  raw_body=$(printf '%s' "$body" | sed '$d')
  auth=$(printf '%s' "$raw_body" | jq -er '.auth // "unknown"' 2>/dev/null) || return 1
  [ "$auth" != "failed" ]
}

# DB の OPEN ポジション件数を取得する。
# psql の exit code は SQL エラーで 0 を返すことがあるため、
# ON_ERROR_STOP=1 と数値正規表現で二重防御する。
db_open_count() {
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is not set. Check packages/backend/.env." >&2
    exit 1
  fi
  local count
  count=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc \
    "SELECT COUNT(*) FROM positions WHERE status='OPEN'" 2>/dev/null \
    | tr -d '[:space:]') || true
  if ! [[ "$count" =~ ^[0-9]+$ ]]; then
    echo "Failed to get OPEN position count from DB. Check DATABASE_URL and the Postgres container." >&2
    exit 1
  fi
  echo "$count"
}

# DB の OPEN ポジション ID を空白区切りで取得する（HC 失敗時の列挙表示用）。
db_open_position_ids() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc \
    "SELECT id FROM positions WHERE status='OPEN'" 2>/dev/null \
    | tr '\n' ' ' \
    | sed 's/ *$//' || true
}

# GMO FX API から openPositions の件数を取得する。
# 署名対象は timestamp + method + path + body。path は /private を除いた形式
# （toSignaturePath 準拠: packages/backend/src/adapter/gmo/GmoRestClient.ts:213-215）。
# macOS の date は %N 非対応のためミリ秒タイムスタンプは python3 経由で生成する。
gmo_open_positions_count() {
  local ts method sign_path sign
  if [ -z "${GMO_API_KEY:-}" ] || [ -z "${GMO_API_SECRET:-}" ]; then
    echo "GMO_API_KEY / GMO_API_SECRET are not set." >&2
    return 1
  fi
  if ! command -v python3 > /dev/null 2>&1; then
    echo "python3 not found. Run install.sh to check required tools." >&2
    return 1
  fi

  ts=$(python3 -c 'import time; print(int(time.time()*1000))')
  method="GET"
  sign_path="/v1/openPositions"
  sign=$(printf '%s' "${ts}${method}${sign_path}" \
    | openssl dgst -sha256 -mac HMAC -macopt "key:$GMO_API_SECRET" \
    | sed 's/^.*= //')

  curl -fsS --max-time 5 \
    "https://forex-api.coin.z.com/private/v1/openPositions?symbol=USD_JPY" \
    -H "API-KEY: $GMO_API_KEY" \
    -H "API-TIMESTAMP: $ts" \
    -H "API-SIGN: $sign" \
  | jq -r '.data.list | length'
}

# Postgres コンテナが起動しているか確認する。
postgres_running() {
  local running
  running=$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)
  [ "$running" = "true" ]
}

# -s: 安全な起動 + 起動後ヘルスチェック
cmd_start() {
  if ! postgres_running; then
    echo "Postgres container ($POSTGRES_CONTAINER) is not running." >&2
    echo "  Run: docker start $POSTGRES_CONTAINER and try again." >&2
    exit 1
  fi

  local status
  status=$(pm2_status)
  if [ "$status" = "online" ]; then
    echo "Already running. Running post-start health check only."
  else
    # ecosystem.config.cjs の cwd が相対パスのためリポジトリルートに移動して起動。
    (cd "$REPO_ROOT" && pm2 start "$ECOSYSTEM_CONFIG" --only "$APP_NAME")
    pm2 save > /dev/null
  fi

  # 起動後ヘルスチェック。
  # cold start 実測 (2026-05-27): 2.225s / 2.079s / 2.088s (max 2.225s)。
  # 初回起動・高負荷時のマージン込みで実測値の約 7 倍を採用。
  local timeout=15
  local elapsed=0
  echo "Post-start health check... (timeout ${timeout}s)"
  while [ $elapsed -lt $timeout ]; do
    status=$(pm2_status)
    if [ "$status" = "online" ] && _curl_health; then
      echo "OK"
      exit 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "Post-start health check failed (timeout ${timeout}s)" >&2
  echo "--- pm2 logs $APP_NAME --lines 50 --nostream ---" >&2
  pm2 logs "$APP_NAME" --lines 50 --nostream >&2 || true
  exit 1
}

# -e: 停止（ポジションは保持。決済しない）
# OPEN ポジションは GMO 側に残り、次回起動時に bot が監視を再開する。
# 停止後 HC は「DB OPEN = GMO openPositions」の件数照合で整合を確認する。
cmd_stop() {
  echo "Note: this command operates on the DB. Positions opened manually on GMO are not protected (invisible to the bot)."
  echo

  local open_count
  open_count=$(db_open_count)

  if [ "$open_count" -gt 0 ]; then
    # 非対話実行を tty で検出して拒否する。
    if [ ! -t 0 ]; then
      echo "Refusing to stop in non-interactive mode. Run from a terminal where you can answer y explicitly." >&2
      exit 1
    fi

    cat <<EOF
DB OPEN: $open_count position(s).
Stopping does NOT close them; they remain held on the broker (GMO).
On the next \`luchida -s\`, the bot takes over the OPEN positions in DB and resumes monitoring / exit evaluation.
EOF

    local ans
    # tty 判定の二重防御として /dev/tty から直接読む。
    read -r -p "Stop? (y/N): " ans < /dev/tty
    if [ "$ans" != "y" ]; then
      echo "Stop aborted."
      exit 1
    fi
  fi

  local status_pre
  status_pre=$(pm2_status)
  if [ -n "$status_pre" ]; then
    pm2 delete "$APP_NAME"
    pm2 save > /dev/null
  else
    echo "Bot is already stopped ($APP_NAME is not in pm2 list)."
  fi

  echo "Post-stop health check..."

  local pm2_state db_count gmo_count
  pm2_state=$(pm2_status)
  db_count=$(db_open_count)
  # GMO API がエラー (401 / ネット切断等) の場合は "ERR" として続行する。
  gmo_count=$(gmo_open_positions_count 2>/dev/null) || gmo_count="ERR"

  # 成功条件: bot プロセスが停止し、DB OPEN 件数が GMO openPositions 件数と一致すること。
  # ポジションは保持される前提なので、件数が 0 である必要はなく「一致」していれば整合。
  if [ -z "$pm2_state" ] && [ "$gmo_count" != "ERR" ] && [ "$db_count" -eq "$gmo_count" ]; then
    echo "OK (DB OPEN $db_count = GMO openPositions $gmo_count; positions preserved)"
    exit 0
  fi

  echo "Post-stop health check failed" >&2
  if [ -n "$pm2_state" ]; then
    echo "  - pm2: $APP_NAME still present (status=$pm2_state)" >&2
  fi
  if [ "$db_count" -gt 0 ]; then
    local ids
    ids=$(db_open_position_ids)
    echo "  - DB OPEN: $db_count [posId=${ids// /, posId=}]" >&2
  else
    echo "  - DB OPEN: 0" >&2
  fi
  echo "  - GMO openPositions: $gmo_count" >&2
  if [ "$gmo_count" = "ERR" ]; then
    echo "  - Interpretation: GMO API check failed (auth error / network issue); could not verify count match" >&2
  elif [ "$db_count" -ne "$gmo_count" ]; then
    echo "  - Interpretation: DB and GMO OPEN counts mismatch; the startup auto-sync may reconcile it, but verify manually" >&2
  fi
  exit 1
}

# 稼働中バージョンを "vX.Y.Z (shorthash)" 形式で返す。
# version は root package.json を正とし、hash は HEAD の短縮形を使う。
# 取得に失敗した要素は "unknown" にフォールバックして、表示自体は必ず行う。
running_version() {
  local version hash
  version=$(jq -r '.version // empty' "$REPO_ROOT/package.json" 2>/dev/null) || true
  [ -n "$version" ] || version="unknown"
  hash=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null) || true
  [ -n "$hash" ] || hash="unknown"
  echo "v${version} (${hash})"
}

# -r 専用の停止処理。
# cmd_stop (-e) は exit で抜けるうえ「件数照合の不整合 = 失敗」とするため、
# 再起動フローからは再利用しない。-r では「pm2 から APP_NAME が消えたか」
# = プロセス停止の成否だけを return 値の基準にし、DB/GMO の件数照合は
# 警告として出すに留めて起動まで進む（再起動が目的のため bot を落としたままにしない）。
#
# return 0: プロセス停止成功（件数照合の結果は問わない）
# return 1: ユーザーが停止を拒否、または pm2 にプロセスが残存（本物の停止失敗）
_restart_stop() {
  local open_count
  open_count=$(db_open_count)

  if [ "$open_count" -gt 0 ]; then
    if [ ! -t 0 ]; then
      echo "Refusing to stop in non-interactive mode. Run from a terminal where you can answer y explicitly." >&2
      return 1
    fi
    cat <<EOF
DB OPEN: $open_count position(s).
Stopping does NOT close them; they remain held on the broker (GMO).
After restart, the bot takes over the OPEN positions in DB and resumes monitoring / exit evaluation.
EOF
    local ans
    read -r -p "Stop for restart? (y/N): " ans < /dev/tty
    if [ "$ans" != "y" ]; then
      echo "Restart aborted."
      return 1
    fi
  fi

  local status_pre
  status_pre=$(pm2_status)
  if [ -n "$status_pre" ]; then
    pm2 delete "$APP_NAME"
    pm2 save > /dev/null
  else
    echo "Bot is already stopped ($APP_NAME is not in pm2 list)."
  fi

  # プロセス停止の成否判定。pm2 から消えていなければ本物の停止失敗。
  local pm2_state
  pm2_state=$(pm2_status)
  if [ -n "$pm2_state" ]; then
    echo "Stop failed: $APP_NAME still present in pm2 (status=$pm2_state)" >&2
    return 1
  fi

  # ここからは件数照合（整合確認）。不整合でも return 0 のまま起動へ進み、警告だけ出す。
  local db_count gmo_count
  db_count=$(db_open_count)
  gmo_count=$(gmo_open_positions_count 2>/dev/null) || gmo_count="ERR"

  if [ "$gmo_count" != "ERR" ] && [ "$db_count" -eq "$gmo_count" ]; then
    echo "Stop OK (DB OPEN $db_count = GMO openPositions $gmo_count; positions preserved)"
  else
    echo "Stop OK (process stopped), but check the count reconciliation:" >&2
    if [ "$db_count" -gt 0 ]; then
      local ids
      ids=$(db_open_position_ids)
      echo "  - DB OPEN: $db_count [posId=${ids// /, posId=}]" >&2
    else
      echo "  - DB OPEN: 0" >&2
    fi
    echo "  - GMO openPositions: $gmo_count" >&2
    if [ "$gmo_count" = "ERR" ]; then
      echo "  - Interpretation: GMO API check failed (auth error / network issue); could not verify count match" >&2
    else
      echo "  - Interpretation: DB and GMO OPEN counts mismatch; the startup auto-sync may reconcile it, but verify manually" >&2
    fi
    echo "  (process is stopped; proceeding to start)" >&2
  fi
  return 0
}

# -r: 最新 main を反映して再起動（pull → 停止 → 起動）
#
# self-update 問題への対処:
# git pull で bin/luchida.sh 自身が書き換わるため、pull 後も同じプロセスで
# 停止・起動を続けると「メモリ上の古いスクリプト」で動いてしまう。これを避けるため、
# 2 フェーズに分割し環境変数 LUCHIDA_RESTART_PHASE で制御する。
#   フェーズ1 (未設定): fetch → checkout main → pull → exec で新スクリプトに置換
#   フェーズ2 (=run):   pull せず、停止 → 起動 のみ（exec 後なので最新コード）
# exec によりプロセスを最新版に置き換えるため、二重 pull もメモリ不整合も起きない。
cmd_restart() {
  if [ "${LUCHIDA_RESTART_PHASE:-}" != "run" ]; then
    # --- フェーズ1: 最新 main を反映して、新スクリプトへ exec ---
    echo "Updating to latest main (fetch -> checkout main -> pull)..."

    # git 操作はいずれも停止前なので、失敗しても bot は生きたまま（安全側）。
    # ただし set -e の生エラーだけ残ると原因が伝わらないため、各段で文脈を添える。
    if ! git -C "$REPO_ROOT" fetch origin; then
      echo "Restart aborted: git fetch failed (check network / auth). Bot keeps running unchanged." >&2
      exit 1
    fi
    if ! git -C "$REPO_ROOT" checkout main; then
      echo "Restart aborted: checkout to main failed (uncommitted changes may conflict)." >&2
      echo "  Check git status, stash your changes, then retry. Bot keeps running unchanged." >&2
      exit 1
    fi
    local before after
    before=$(git -C "$REPO_ROOT" rev-parse HEAD)
    if ! git -C "$REPO_ROOT" pull --ff-only origin main; then
      echo "Restart aborted: fast-forward pull of origin/main failed." >&2
      echo "  Local main may have diverged from origin (e.g. direct commits on the production machine)." >&2
      echo "  Inspect with: git log --oneline main..origin/main / origin/main..main. Bot keeps running unchanged." >&2
      exit 1
    fi
    after=$(git -C "$REPO_ROOT" rev-parse HEAD)

    if [ "$before" = "$after" ]; then
      echo "-> Already on latest main (no update). Restarting anyway (e.g. for config changes)."
    else
      echo "-> Updated to latest main ($(git -C "$REPO_ROOT" rev-parse --short "$before") -> $(git -C "$REPO_ROOT" rev-parse --short "$after"))"
    fi
    echo

    # 反映有無を引き継ぎ、最新版の自分自身へ置き換える。
    # 以降の停止・起動は pull 済みの新コードで実行される。
    if [ ! -x "$REPO_ROOT/bin/luchida.sh" ]; then
      echo "Restart aborted: $REPO_ROOT/bin/luchida.sh missing or not executable after pull." >&2
      echo "  Bot keeps running unchanged. Run luchida -e then luchida -s manually." >&2
      exit 1
    fi
    export LUCHIDA_RESTART_PHASE="run"
    export LUCHIDA_RESTART_UPDATED
    if [ "$before" = "$after" ]; then LUCHIDA_RESTART_UPDATED=false; else LUCHIDA_RESTART_UPDATED=true; fi
    exec "$REPO_ROOT/bin/luchida.sh" -r
  fi

  # --- フェーズ2: 停止 → 起動（exec 後。最新コードで動作） ---
  # phase は消費したら unset し、子プロセスへ run が漏れる事故を防ぐ（防御的）。
  unset LUCHIDA_RESTART_PHASE
  local updated="${LUCHIDA_RESTART_UPDATED:-false}"

  echo "=== Stop ==="
  local stop_rc=0
  (_restart_stop) || stop_rc=$?
  if [ "$stop_rc" -ne 0 ]; then
    echo >&2
    echo "Restart failed: aborted at the stop phase (bot was NOT restarted)." >&2
    exit "$stop_rc"
  fi

  echo
  echo "=== Start ==="
  # cmd_start は成功時 exit 0 のため、サブシェルで受けてから最終サマリを出す。
  local start_rc=0
  (cmd_start) || start_rc=$?
  echo
  if [ "$start_rc" -ne 0 ]; then
    # 起動 HC 失敗は -r で最も危険な状態。停止は完了済み（_restart_stop で確認済み）で、
    # pm2 start はしたが HC が通っていない = 市場監視ループ（ExitRule の自動決済）が
    # 立ち上がっているか不確実。OPEN ポジション保持中なら損切りが効かないリスクに直結する。
    # 単なる「HC NG」では弱いため、ポジション件数と pm2 状態を区別して最大級に警告する。
    local pm2_state open_now
    pm2_state=$(pm2_status)
    open_now=$(db_open_count 2>/dev/null) || open_now="unknown"
    echo "================================================================" >&2
    echo "Restart FAILED: post-start health check did not pass." >&2
    echo "[IMMEDIATE ACTION REQUIRED] The bot may not have resumed market monitoring." >&2
    if [ -n "$pm2_state" ]; then
      echo "  - pm2: $APP_NAME exists (status=$pm2_state) but HC failed; process is up but not responding" >&2
    else
      echo "  - pm2: $APP_NAME not in list; process is down (startup likely failed)" >&2
    fi
    if [ "$open_now" != "unknown" ] && [ "$open_now" -gt 0 ] 2>/dev/null; then
      local ids
      ids=$(db_open_position_ids 2>/dev/null) || ids=""
      echo "  - DB OPEN: $open_now [posId=${ids// /, posId=}] -- exit evaluation does NOT run while monitoring is down" >&2
    else
      echo "  - DB OPEN: $open_now" >&2
    fi
    echo "  Action: run \`luchida -c\` to re-check, and \`pm2 logs $APP_NAME --lines 50\` to investigate." >&2
    echo "          If not recovered, try \`luchida -s\`." >&2
    echo "================================================================" >&2
    exit "$start_rc"
  fi

  if [ "$updated" = true ]; then
    echo "Restart complete: updated to latest main. Running version $(running_version)"
  else
    echo "Restart complete: main unchanged. Running version $(running_version)"
  fi
  exit 0
}

# -c: 独立ヘルスチェック
cmd_check() {
  local status
  status=$(pm2_status)
  if [ -z "$status" ]; then
    echo "bot is not running. use \`luchida -s\` to start."
    exit 1
  fi

  if _curl_health; then
    echo "OK"
    exit 0
  fi

  echo "health check failed:" >&2
  curl -s -o /dev/null \
    -w "  http_code=%{http_code}\n  errormsg=%{errormsg}\n" \
    --max-time 3 --connect-timeout 1 "$HEALTH_URL" >&2 || true
  # 認証状態も出す（#290）。auth=failed なら API キー・シークレットを疑う。
  local auth
  auth=$(curl -s --max-time 3 --connect-timeout 1 "$HEALTH_URL" 2>/dev/null \
    | jq -r '.auth // "unknown"' 2>/dev/null || echo "unknown")
  echo "  auth=$auth" >&2
  exit 1
}

# adx: 全通貨ペア × 各時間足の ADX/DI 一覧（調査用）。
# 受け取った引数（--period / --bars）はそのまま TS スクリプトへ透過する。
#
# スクリプトは ESM の相対 import を含むため、必ず packages/backend を cwd にして
# 実行する（リポジトリルートからだと scripts/ が解決できず ERR_MODULE_NOT_FOUND）。
#
# bats が存在しないパスへ差し替えて「スクリプト不在」分岐を検証するため、
# 他のパス定数と違い readonly にしない（テストシーム）。
ADX_SCRIPT_REL="scripts/adx-di-overview.ts"
cmd_adx() {
  if ! command -v node > /dev/null 2>&1; then
    echo "node not found. Run install.sh to check required tools." >&2
    exit 1
  fi

  local backend_dir="$REPO_ROOT/packages/backend"
  if [ ! -f "$backend_dir/$ADX_SCRIPT_REL" ]; then
    echo "ADX script not found: $backend_dir/$ADX_SCRIPT_REL" >&2
    exit 1
  fi

  # 調査用の一覧表示なので、内部の通信 INFO ログ（Public GET / スロットリング待機等）が
  # 結果に混ざらないよう既定で WARN まで抑制する。WARN 以上（レート制限リトライ等の
  # 異常の予兆とエラー）は見える。ログを見たいときは LOG_LEVEL=INFO luchida adx で上書きできる。
  (cd "$backend_dir" && LOG_LEVEL="${LOG_LEVEL:-WARN}" node --import tsx "$ADX_SCRIPT_REL" "$@")
}

# update: 既に導入済みの環境を、pull 済みの最新 CLI に追従させる。
# 「導入(install.sh)」とは関心事が別（こちらは追従が目的）なので共通化していない。
#
# pull だけで反映されないのは zsh 補完キャッシュ（~/.zcompdump）。_luchida を
# 更新しても古いキャッシュが残ると新しいサブコマンド/オプションが候補に出ない。
# ここを作り直すのが update の主目的。エイリアス自体は luchida.sh 参照なので
# pull で最新化され、再登録は不要（新規登録は install.sh の役目）。
#
# bot / GMO / DB に一切依存しないため、.env や依存ツールが無くても動作する。
cmd_update() {
  if [ ! -x "$SELF_SCRIPT" ]; then
    chmod +x "$SELF_SCRIPT"
    echo "Granted execute permission to luchida.sh"
  fi

  local completion="$SCRIPT_DIR/completions/_luchida"
  local zcompdump="$HOME/.zcompdump"
  if [ ! -f "$completion" ]; then
    echo "Completion file not found: $completion (skipping cache refresh)" >&2
  elif [ ! -f "$zcompdump" ]; then
    echo "No completion cache found (~/.zcompdump); nothing to refresh."
  elif [ "$completion" -nt "$zcompdump" ]; then
    # _luchida がキャッシュより新しいときだけ作り直す（冪等。install.sh と同方針）。
    rm -f "$HOME"/.zcompdump*
    echo "Cleared completion cache ~/.zcompdump* (_luchida was updated)"
  else
    echo "Completion cache is up to date (no refresh needed)"
  fi

  echo "Update complete. Run \`source ~/.zshrc\` or open a new terminal to apply."
}

main() {
  if [ $# -eq 0 ]; then
    usage
    exit 1
  fi

  # 第1引数で運用フラグ（-x）と名前付きサブコマンドを振り分ける。
  # 名前付きサブコマンドは shift して残りの引数をそのまま委譲する。
  case "$1" in
    -s) require_no_extra_args "$#"; cmd_start ;;
    -e) require_no_extra_args "$#"; cmd_stop ;;
    -r) require_no_extra_args "$#"; cmd_restart ;;
    -c) require_no_extra_args "$#"; cmd_check ;;
    -h|--help) usage ;;
    adx) shift; cmd_adx "$@" ;;
    update) require_no_extra_args "$#"; cmd_update ;;
    *)  usage; exit 1 ;;
  esac
}

# bats から source して関数だけテストできるよう、直接実行時のみ
# .env 読み込みと main を実行する。
# source 時は $0 がこのスクリプトのパスと一致しないため副作用をスキップする。
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  parse_env_file "$ENV_FILE"
  main "$@"
fi
