/**
 * ドメイン層から構造化ログ出力を行うためのポート（Hexagonal Architecture）。
 *
 * ドメインクラス（`TimeFrameBook` / `SmaCrossEntryRule` 等）が直接 infrastructure 層の
 * `Logger` に依存すると DDD レイヤーが壊れるため、本 interface を介して DI で注入する。
 *
 * 実装（adapter）:
 *   - 本番: `infrastructure/logging/Logger.ts`（`implements LogPort`）
 *   - テスト: `domain/port/NoopLogPort.ts`（出力なし）
 *
 * 設計判断:
 *   - `context` は実装側のコンストラクタで埋める（main.ts 等で `new Logger('TimeFrameBook')`）。
 *     ドメイン層は「自分が誰か」を知らずにログを発する。
 *   - レベルフィルタリング・出力先などは実装に閉じる。ドメインは `info` / `debug` 等の
 *     語彙だけを語る。
 */
export interface LogPort {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}
