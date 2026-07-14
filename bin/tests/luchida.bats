#!/usr/bin/env bats
#
# bin/luchida.sh の .env パーサのユニットテスト（#291）。
#
# luchida.sh を source して関数だけ取り込む。スクリプト末尾の
# `if [ "${BASH_SOURCE[0]}" = "${0}" ]` ガードにより、source 時は
# .env 読み込みと main が走らないため副作用なくテストできる。
#
# テスト名は ASCII のみ（bats のテスト名解析がマルチバイトで壊れるため）。

setup() {
  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/luchida.sh"
  TEST_ENV="$BATS_TEST_TMPDIR/.env"
}

# --- normalize_env_value: 値の正規化（クォート剥がし・CRLF 除去） ---

# クォート無しはそのまま
@test "normalize_env_value: plain value passes through" {
  run normalize_env_value "plain_value"
  [ "$status" -eq 0 ]
  [ "$output" = "plain_value" ]
}

# ダブルクォートを1組だけ剥がす
@test "normalize_env_value: strips one pair of double quotes" {
  run normalize_env_value '"quoted"'
  [ "$output" = "quoted" ]
}

# シングルクォートを1組だけ剥がす
@test "normalize_env_value: strips one pair of single quotes" {
  run normalize_env_value "'quoted'"
  [ "$output" = "quoted" ]
}

# 入れ子クォートは外側1組のみ剥がす
@test "normalize_env_value: strips only the outer pair of nested quotes" {
  run normalize_env_value '""nested""'
  [ "$output" = '"nested"' ]
}

# 空値はそのまま空
@test "normalize_env_value: empty value stays empty" {
  run normalize_env_value ""
  [ "$output" = "" ]
}

# 値中の = は保持する
@test "normalize_env_value: keeps equals signs inside the value" {
  run normalize_env_value "key=part=value"
  [ "$output" = "key=part=value" ]
}

# 末尾 CR を除去する
@test "normalize_env_value: trims trailing CR" {
  run normalize_env_value $'value\r'
  [ "$output" = "value" ]
}

# CRLF 付きクォート値を正しく剥がす
@test "normalize_env_value: handles CRLF together with quotes" {
  run normalize_env_value $'"value"\r'
  [ "$output" = "value" ]
}

# 非対称クォートは剥がさない
@test "normalize_env_value: leaves unbalanced quotes untouched" {
  run normalize_env_value '"unbalanced'
  [ "$output" = '"unbalanced' ]
}

# --- parse_env_file: ファイル全体のパース + export ---

# 単純な KEY=VALUE を export する
@test "parse_env_file: exports a simple KEY=VALUE" {
  printf 'FOO=bar\n' > "$TEST_ENV"
  parse_env_file "$TEST_ENV"
  [ "$FOO" = "bar" ]
}

# クォート値を剥がして export する
@test "parse_env_file: strips quotes before exporting" {
  printf 'FOO="bar"\n' > "$TEST_ENV"
  parse_env_file "$TEST_ENV"
  [ "$FOO" = "bar" ]
}

# コメント行を無視する
@test "parse_env_file: ignores comment lines" {
  printf '# comment\nFOO=bar\n' > "$TEST_ENV"
  parse_env_file "$TEST_ENV"
  [ "$FOO" = "bar" ]
}

# 空行を無視する
@test "parse_env_file: ignores blank lines" {
  printf '\nFOO=bar\n\n' > "$TEST_ENV"
  parse_env_file "$TEST_ENV"
  [ "$FOO" = "bar" ]
}

# 空値を export する
@test "parse_env_file: exports an empty value" {
  printf 'EMPTY=\n' > "$TEST_ENV"
  parse_env_file "$TEST_ENV"
  [ -n "${EMPTY+x}" ]
  [ "$EMPTY" = "" ]
}

# 不正なキー名の行をスキップする
@test "parse_env_file: skips invalid key names" {
  printf 'BAD KEY=skip\nGOOD=ok\n' > "$TEST_ENV"
  parse_env_file "$TEST_ENV"
  [ "$GOOD" = "ok" ]
  [ -z "${BAD+x}" ]
}

# 既存の環境変数を上書きしない（CLI 優先）
@test "parse_env_file: does not override an existing env var (CLI wins)" {
  export FOO="from_cli"
  printf 'FOO=from_env\n' > "$TEST_ENV"
  parse_env_file "$TEST_ENV"
  [ "$FOO" = "from_cli" ]
}

# CRLF 行末を正しく処理する
@test "parse_env_file: handles CRLF line endings" {
  printf 'FOO="bar"\r\n' > "$TEST_ENV"
  parse_env_file "$TEST_ENV"
  [ "$FOO" = "bar" ]
}

# 末尾改行が無い最終行も読む
@test "parse_env_file: reads the last line without a trailing newline" {
  printf 'FOO=bar' > "$TEST_ENV"
  parse_env_file "$TEST_ENV"
  [ "$FOO" = "bar" ]
}

# 値中の = を保持する（DATABASE_URL 想定）
@test "parse_env_file: keeps equals signs in the value (DATABASE_URL)" {
  printf 'DATABASE_URL=postgres://u:p@h:5432/db?x=1\n' > "$TEST_ENV"
  parse_env_file "$TEST_ENV"
  [ "$DATABASE_URL" = "postgres://u:p@h:5432/db?x=1" ]
}

# 存在しないファイルは何もせず正常終了する
@test "parse_env_file: missing file is a no-op and succeeds" {
  run parse_env_file "$BATS_TEST_TMPDIR/does_not_exist"
  [ "$status" -eq 0 ]
}

# --- main: コマンドのディスパッチ ---
# 実際の副作用（pm2 / docker / network）を避けるため、各 cmd_* を
# スタブに差し替え、main のルーティングだけを検証する。

# 引数なしは usage を出して非ゼロ終了する
@test "main: no args prints usage and exits non-zero" {
  run main
  [ "$status" -ne 0 ]
  [[ "$output" == *"Usage: luchida"* ]]
}

# 未対応サブコマンドは usage を出して非ゼロ終了する
@test "main: unknown subcommand prints usage and exits non-zero" {
  run main bogus
  [ "$status" -ne 0 ]
  [[ "$output" == *"Usage: luchida"* ]]
}

# -s は cmd_start にルーティングされる
@test "main: -s routes to cmd_start" {
  cmd_start() { echo "START_CALLED"; }
  run main -s
  [ "$status" -eq 0 ]
  [[ "$output" == *"START_CALLED"* ]]
}

# bot 運用フラグに余分な引数を付けると拒否される
@test "main: -s with extra arg is rejected" {
  cmd_start() { echo "START_CALLED"; }
  run main -s extra
  [ "$status" -ne 0 ]
  [[ "$output" != *"START_CALLED"* ]]
}

# adx は cmd_adx にルーティングされ、残りの引数がそのまま渡る
@test "main: adx routes to cmd_adx and forwards args" {
  cmd_adx() { echo "ADX_CALLED $*"; }
  run main adx --period 14 --bars 30
  [ "$status" -eq 0 ]
  [[ "$output" == *"ADX_CALLED --period 14 --bars 30"* ]]
}

# adx は引数なしでも cmd_adx にルーティングされる
@test "main: adx without args routes to cmd_adx" {
  cmd_adx() { echo "ADX_CALLED args=[$*]"; }
  run main adx
  [ "$status" -eq 0 ]
  [[ "$output" == *"ADX_CALLED args=[]"* ]]
}

# --- cmd_adx: 前提チェック ---

# スクリプトが見つからない場合はエラーで終了する。
# REPO_ROOT は readonly のため、参照する相対パス側を存在しない値に差し替えて検証する。
@test "cmd_adx: errors when the script is missing" {
  ADX_SCRIPT_REL="scripts/__nonexistent__.ts"
  run cmd_adx
  [ "$status" -ne 0 ]
  [[ "$output" == *"ADX script not found"* ]]
}

# --- main: update のディスパッチ ---

# update は cmd_update にルーティングされる
@test "main: update routes to cmd_update" {
  cmd_update() { echo "UPDATE_CALLED"; }
  run main update
  [ "$status" -eq 0 ]
  [[ "$output" == *"UPDATE_CALLED"* ]]
}

# update に余分な引数を付けると拒否される（引数を取らないサブコマンド）
@test "main: update with extra arg is rejected" {
  cmd_update() { echo "UPDATE_CALLED"; }
  run main update extra
  [ "$status" -ne 0 ]
  [[ "$output" != *"UPDATE_CALLED"* ]]
}

# --- cmd_update: 補完キャッシュの扱い ---
# 実ファイルの ~/.zcompdump を触らないよう HOME を一時ディレクトリにサンドボックス化する。

# キャッシュが無ければ削除せず案内のみ（安全側）
@test "cmd_update: no cache present is a safe no-op" {
  HOME="$BATS_TEST_TMPDIR"  # ~/.zcompdump が存在しないサンドボックス
  run cmd_update
  [ "$status" -eq 0 ]
  [[ "$output" == *"No completion cache found"* ]]
  [[ "$output" == *"Update complete"* ]]
}

# 古いキャッシュがあれば作り直す（_luchida の方が新しいので必ず再生成される）
@test "cmd_update: stale cache is cleared" {
  HOME="$BATS_TEST_TMPDIR"
  touch -t 200001010000 "$HOME/.zcompdump"  # _luchida より十分古いタイムスタンプ
  run cmd_update
  [ "$status" -eq 0 ]
  [[ "$output" == *"Cleared completion cache"* ]]
  [ ! -f "$HOME/.zcompdump" ]
}
