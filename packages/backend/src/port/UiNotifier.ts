import type { EntryCommand } from '../domain/command/EntryCommand.js';
import type { ExitCommand } from '../domain/command/ExitCommand.js';

/**
 * UI への通知窓口。
 * - エントリーシグナル検知時: UIにシグナル状態を表示する
 * - エントリーシグナル消失時: UIのシグナル表示を消す
 * - 決済実行時: 決済が実行されたことを UI に通知する
 * 実装は WebSocket 経由でフロントエンドに送信する。
 */
export interface UiNotifier {
  /** エントリー準備が整ったことを UI に通知する */
  notifyEntryReady(command: EntryCommand): Promise<void>;
  /** エントリーが期限切れになったことを UI に通知する */
  notifyEntryExpired(command: EntryCommand): Promise<void>;
  /** 決済が実行されたことを UI に通知する */
  notifyExitExecuted(command: ExitCommand): Promise<void>;
  /**
   * kill-switch 等で取引セッションが停止したことを UI に通知する（#186）。
   * 停止後の復旧は人間の再起動判断に委ねるため、理由を必ず添える。
   */
  notifyTradingHalted(reason: string): Promise<void>;
}
