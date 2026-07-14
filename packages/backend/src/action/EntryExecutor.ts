import type { EntryCommand } from '../domain/command/EntryCommand.js';

/**
 * EntryQueue が依存する最小ポート。EntryExecution の openPosition だけを公開。
 * テストで EntryExecution 全体を mock する負担を減らすために interface 化する。
 *
 * 設計書: docs/design/position-manager/policies.md 3.3
 */
export interface EntryExecutor {
  openPosition(command: EntryCommand): Promise<void>;
}
