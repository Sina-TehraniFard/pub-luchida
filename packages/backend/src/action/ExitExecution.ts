import { ExitCommand } from '../domain/command/ExitCommand.js';
import { Price } from '../domain/market/Price.js';
import { Broker } from '../port/Broker.js';
import { PositionRepository } from '../port/PositionRepository.js';
import type { ExitCompensationQueuePort } from '../port/ExitCompensationQueuePort.js';
import type { LogPort } from '../domain/port/LogPort.js';

/**
 * 決済注文の実行
 * - ExitCommand を受け取り決済注文を出す
 * - 判定ロジックは持たない
 *
 * 部分成功の扱い（#186）:
 * `broker.placeExit` が成功した時点で決済は取り消せない。その後の
 * `position.close` / `positionRepository.update` が失敗しても throw で
 * 呼び出し側に「失敗」を返すと、次 tick で存在しない建玉へ再発注される
 * （発注スパム）。よって broker 成功後の失敗は補償キューへ登録し、
 * 呼び出し側には決済成功として正常 return する。
 */
export class ExitExecution {
    constructor(
        private readonly broker: Broker,
        private readonly positionRepository: PositionRepository,
        private readonly compensationQueue: ExitCompensationQueuePort,
        private readonly logger: LogPort,
    ) {}

    async closePosition(
        command: ExitCommand,
        extremes?: { highest: Price; lowest: Price },
    ): Promise<void> {
        const position = await this.positionRepository.findById(command.positionId);
        if (extremes) {
            position.applyExtremes(extremes.highest, extremes.lowest);
        }
        // ここまでの失敗は throw で伝搬してよい（broker 未実行＝ゴーストは生まれない）
        const result = await this.broker.placeExit(position);

        // --- 以降、broker 側の決済は確定。失敗は補償キューへ（throw しない） ---
        try {
            position.close(command, result);
        } catch (err) {
            this.logger.error('部分成功検出: broker 決済済みだが Position.close に失敗 - markClosed 補償へ', {
                event: 'exit_partial_success_detected',
                phase: 'close',
                positionId: position.id.toString(),
                error: String(err),
            });
            this.compensationQueue.enqueueMarkClosed(position.id);
            return;
        }
        try {
            await this.positionRepository.update(position);
        } catch (err) {
            this.logger.error('部分成功検出: broker 決済済みだが DB update に失敗 - update 補償へ', {
                event: 'exit_partial_success_detected',
                phase: 'update',
                positionId: position.id.toString(),
                error: String(err),
            });
            this.compensationQueue.enqueueUpdate(position);
            return;
        }
    }
}
