import type { Server as SocketIOServer } from 'socket.io';
import type { UiNotifier } from '../../port/UiNotifier.js';
import type { EntryCommand } from '../../domain/command/EntryCommand.js';
import type { ExitCommand } from '../../domain/command/ExitCommand.js';
import { Logger } from '../logging/Logger.js';

/**
 * UiNotifier の実装。
 * socket.io 経由でフロントエンドにイベントを送信する。
 */
export class SocketIoUiNotifier implements UiNotifier {
  // エントリー・決済イベントの UI 配信なので話題は TRADE（配信機構の障害も同じタブで追える）
  private readonly logger = new Logger('SocketIoUiNotifier', 'TRADE');

  constructor(private readonly io: SocketIOServer) {}

  async notifyEntryReady(command: EntryCommand): Promise<void> {
    this.io.emit('entry:ready', {
      pair: command.pair,
      side: command.buySell,
      lot: command.lot.toString(),
      reason: command.reason.toString(),
    });
    this.logger.info('entry:ready を送信', { pair: command.pair, side: command.buySell });
  }

  async notifyEntryExpired(command: EntryCommand): Promise<void> {
    this.io.emit('entry:expired', {
      pair: command.pair,
      side: command.buySell,
    });
    this.logger.info('entry:expired を送信', { pair: command.pair });
  }

  async notifyExitExecuted(command: ExitCommand): Promise<void> {
    this.io.emit('exit:executed', {
      positionId: command.positionId.toString(),
      type: command.type,
      reason: command.reason.toString(),
    });
    this.logger.info('exit:executed を送信', { positionId: command.positionId.toString() });
  }

  async notifyTradingHalted(reason: string): Promise<void> {
    this.io.emit('trading:halted', { reason });
    this.logger.info('trading:halted を送信', { reason });
  }
}
