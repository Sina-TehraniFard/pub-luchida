#!/usr/bin/env bash
#
# luchida CLI セットアップスクリプト
#
# 実行するもの:
#   1. luchida.sh の存在と実行権限を確認
#   2. 依存ツール (jq / python3 / openssl / pm2 / docker / psql / curl) の存在確認
#   3. packages/backend/.env の存在確認
#   4. ~/.zshrc に alias luchida=... を登録（未登録時のみ）
#
# 詳細仕様: https://github.com/Sina-TehraniFard/luchida/issues/191

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly LUCHIDA_SCRIPT="$SCRIPT_DIR/luchida.sh"
# cd 失敗時の終了コードが readonly でマスクされないよう、代入と
# readonly 宣言を分離する (shellcheck SC2155)。luchida.sh と同方針。
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly REPO_ROOT
readonly ENV_FILE="$REPO_ROOT/packages/backend/.env"
readonly ZSHRC="$HOME/.zshrc"

OK="\033[32m✓\033[0m"
WARN="\033[33m⚠\033[0m"
NG="\033[31m✗\033[0m"

echo "=== luchida CLI セットアップ ==="

# --- 1. luchida.sh 確認 ---
echo
echo "--- bin/luchida.sh ---"
if [ ! -f "$LUCHIDA_SCRIPT" ]; then
  echo -e "$NG $LUCHIDA_SCRIPT が見つかりません" >&2
  exit 1
fi
if [ ! -x "$LUCHIDA_SCRIPT" ]; then
  chmod +x "$LUCHIDA_SCRIPT"
  echo -e "$OK $LUCHIDA_SCRIPT に実行権限を付与しました"
else
  echo -e "$OK $LUCHIDA_SCRIPT"
fi

# --- 2. 依存ツール ---
echo
echo "--- 依存ツール ---"
missing=()
check_tool() {
  local tool="$1"
  local hint="$2"
  if command -v "$tool" > /dev/null 2>&1; then
    echo -e "$OK $tool"
  else
    echo -e "$NG $tool が見つかりません  →  $hint"
    missing+=("$tool")
  fi
}

check_tool jq      "brew install jq"
check_tool python3 "macOS 標準で入っているはず（brew install python@3）"
check_tool openssl "brew install openssl"
check_tool pm2     "npm install -g pm2"
check_tool docker  "Docker Desktop をインストール"
check_tool psql    "brew install libpq && brew link --force libpq"
check_tool curl    "macOS 標準で入っているはず"

if [ ${#missing[@]} -gt 0 ]; then
  echo
  echo -e "$NG 不足ツール: ${missing[*]}" >&2
  echo "  上記コマンドでインストールしてから install.sh を再実行してください。" >&2
  exit 1
fi

# --- 3. .env ---
echo
echo "--- packages/backend/.env ---"
if [ -f "$ENV_FILE" ]; then
  echo -e "$OK $ENV_FILE"
else
  echo -e "$WARN $ENV_FILE が見つかりません"
  echo "  packages/backend/.env.example を参考に作成してください"
  echo "  GMO_API_KEY / GMO_API_SECRET / DATABASE_URL が luchida CLI で必要です"
fi

# --- 4. alias 登録 ---
echo
echo "--- alias luchida ---"
ALIAS_LINE="alias luchida=\"$LUCHIDA_SCRIPT\""
if grep -qE "^alias luchida=" "$ZSHRC" 2>/dev/null; then
  # 既存 alias の右辺を取り出し、$HOME などの変数展開後に luchida.sh と比較する。
  # 同じ実体を指していれば形式が違っても登録済みとみなす。
  existing_value=$(grep -E "^alias luchida=" "$ZSHRC" | head -1 \
    | sed -E 's/^alias luchida=//; s/^["'"'"']//; s/["'"'"']$//')
  resolved=$(eval echo "$existing_value")
  if [ "$resolved" = "$LUCHIDA_SCRIPT" ]; then
    echo -e "$OK alias は既に登録済み ($existing_value)"
  else
    echo -e "$WARN 別の luchida alias が $ZSHRC にあります。手動で確認してください:" >&2
    grep -n "^alias luchida=" "$ZSHRC" >&2
    exit 1
  fi
else
  echo "$ALIAS_LINE" >> "$ZSHRC"
  echo -e "$OK alias を $ZSHRC に追加しました"
fi

# --- 5. zsh tab 補完 ---
echo
echo "--- zsh tab 補完 ---"
COMPLETIONS_DIR="$SCRIPT_DIR/completions"
FPATH_LINE="fpath=(\"$COMPLETIONS_DIR\" \$fpath)"
COMPINIT_LINE='autoload -Uz compinit && compinit'

if [ ! -f "$COMPLETIONS_DIR/_luchida" ]; then
  echo -e "$WARN $COMPLETIONS_DIR/_luchida が見つかりません (補完なしで継続)"
else
  # fpath: 既存のパス文字列を検索（冪等）
  if grep -qF "$COMPLETIONS_DIR" "$ZSHRC" 2>/dev/null; then
    echo -e "$OK fpath は既に $ZSHRC に登録済み"
  else
    echo "$FPATH_LINE" >> "$ZSHRC"
    echo -e "$OK fpath を $ZSHRC に追加しました"
  fi

  # compinit: 初期化が無いと補完が読まれない。fpath の後で呼ぶ必要がある。
  if grep -qE "^[[:space:]]*[^#]*compinit" "$ZSHRC" 2>/dev/null; then
    echo -e "$OK compinit は既に $ZSHRC で初期化済み"
  else
    echo "$COMPINIT_LINE" >> "$ZSHRC"
    echo -e "$OK compinit 初期化を $ZSHRC に追加しました"
  fi

  # 補完キャッシュ: _luchida より古い zcompdump があると新しい #compdef が
  # 反映されない。タイムスタンプ比較で必要な時だけ削除（真の冪等性）。
  ZCOMPDUMP="$HOME/.zcompdump"
  if [ -f "$ZCOMPDUMP" ] && [ "$COMPLETIONS_DIR/_luchida" -nt "$ZCOMPDUMP" ]; then
    rm -f "$HOME"/.zcompdump*
    echo -e "$OK 補完キャッシュ ~/.zcompdump* をクリア (_luchida が更新されたため)"
  else
    echo -e "$OK 補完キャッシュは最新（クリア不要）"
  fi
fi

echo
echo "=== セットアップ完了 ==="
echo "  source ~/.zshrc で反映してください（または新規ターミナルを開く）"
echo "  使い方:"
echo "    luchida -s       安全な起動 + 起動後ヘルスチェック"
echo "    luchida -e       停止（ポジションは保持。次回起動で監視再開）+ 停止後ヘルスチェック"
echo "    luchida -c       ヘルスチェック（独立実行）"
echo "    luchida adx      全通貨ペア × 各時間足の ADX/DI 一覧"
echo "    luchida update   pull 後に CLI 補完を最新へ追従"
