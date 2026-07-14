import type { LogPort } from './LogPort.js';

/**
 * 何も出力しない `LogPort` 実装。
 *
 * 主にテスト・スクリプトで「ログ出力に関心がない」呼び出し元のデフォルトとして使う。
 * 本番（`main.ts`）では必ず `Logger`（infrastructure）を注入する。
 *
 * シングルトンとして export し、テストごとにインスタンス生成しない。
 */
export const NoopLogPort: LogPort = {
  debug(): void {},
  info(): void {},
  warn(): void {},
  error(): void {},
};
