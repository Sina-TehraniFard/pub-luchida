import { ExitCommand } from '../domain/command/ExitCommand.js';
import { ExitDispatchResult } from '../domain/exit/ExitDispatchResult.js';
import type {
  ExitDispatchSkipEntry,
  ExitDispatchFailEntry,
} from '../domain/exit/ExitDispatchResult.js';
import type { ExitExecution } from '../action/ExitExecution.js';
import type { ExitRuleRegistry } from '../domain/rule/ExitRuleRegistry.js';
import type { ExtremesSnapshot } from '../domain/position/ExtremesSnapshot.js';
import type { PositionId } from '../domain/position/PositionId.js';
import type { PositionRepository } from '../port/PositionRepository.js';
import type { PositionExtremesPort } from '../port/PositionExtremesPort.js';
import type { ExitCompensationQueuePort } from '../port/ExitCompensationQueuePort.js';
import type { ExitFailureCircuitBreaker } from '../domain/guard/ExitFailureCircuitBreaker.js';
import type { UiNotifier } from '../port/UiNotifier.js';
import type { LogPort } from '../domain/port/LogPort.js';
import type { CurrencyPair } from '../domain/market/CurrencyPair.js';
import type { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';

/**
 * 戦略別 ExitRule ディスパッチの本体。
 * pair-bound で、TradingSession から `dispatch(pair, snapshot)` で呼ばれる。
 *
 * 決済失敗への防御（#186）:
 * - `compensationQueue.has` が真のポジションは broker 決済済み・DB 反映待ちの
 *   ゴースト。再決済せず skip する（シールド）
 * - 失敗したポジションは `failureBreaker` がクールダウンに入れ、再試行を間引く。
 *   連続失敗の kill-switch 判定は TradingSession が dispatch 後に問う
 *
 * 設計書: docs/design/position-manager/step8-pr-b-impl-plan.md Step 4
 *          docs/design/position-manager/step8-brief.md 5.2
 *          docs/design/position-manager/exit-compensation.md
 */
export class ExitDispatcher {
  constructor(
    private readonly registry: ExitRuleRegistry,
    private readonly positionRepository: PositionRepository,
    private readonly exitExecution: ExitExecution,
    private readonly uiNotifier: UiNotifier,
    private readonly extremesPort: PositionExtremesPort,
    private readonly logger: LogPort,
    private readonly compensationQueue: ExitCompensationQueuePort,
    private readonly failureBreaker: ExitFailureCircuitBreaker,
  ) {}

  async dispatch(pair: CurrencyPair, snapshot: MarketSnapshot): Promise<ExitDispatchResult> {
    const ordered = (await this.positionRepository.openPositions())
      .forPair(pair)
      .sortedByOpenedAtAsc();

    // tick を進め、OPEN 集合から消えたポジションの失敗記録を掃除する
    this.failureBreaker.beginTick([...ordered].map((p) => p.id));

    const closed: PositionId[] = [];
    const skipped: ExitDispatchSkipEntry[] = [];
    const failed: ExitDispatchFailEntry[] = [];

    for (const position of ordered) {
      // シールド: broker 決済済み・DB 反映待ちのゴーストを再決済しない。
      // 毎 tick 通る経路なのでログは出さない（enqueue 時に警告済み）
      if (this.compensationQueue.has(position.id)) {
        skipped.push({
          positionId: position.id,
          strategy: position.strategyName,
          reason: 'compensation_pending',
        });
        continue;
      }
      // クールダウン: 失敗直後の再試行を間引く（API 連打の抑制）。同じく無音
      if (!this.failureBreaker.admitAttempt(position.id)) {
        skipped.push({
          positionId: position.id,
          strategy: position.strategyName,
          reason: 'failure_cooldown',
        });
        continue;
      }

      const rule = this.registry.findRule(position.strategyName);
      if (!rule) {
        this.logger.warn('ExitRule 未登録 - 戦略 skip', {
          event: 'exit_rule_missing',
          strategy: position.strategyName,
          positionId: position.id.toString(),
        });
        skipped.push({
          positionId: position.id,
          strategy: position.strategyName,
          reason: 'rule_missing',
        });
        continue;
      }

      try {
        const result = rule.shouldExit(snapshot, position);
        if (result instanceof ExitCommand) {
          if (!result.positionId.equals(position.id)) {
            throw new Error(
              `ExitRule が別 Position の ExitCommand を返却: expected=${position.id.toString()}, actual=${result.positionId.toString()}`,
            );
          }
          const extremes = this.extremesPort.find(position.id);
          if (!extremes) {
            this.logger.warn('ExitCommand 発火したが極値未追跡 - 次 tick 再評価', {
              event: 'exit_extremes_unavailable',
              strategy: position.strategyName,
              positionId: position.id.toString(),
              openedAt: position.openedAt.toString(),
            });
            skipped.push({
              positionId: position.id,
              strategy: position.strategyName,
              reason: 'extremes_unavailable',
            });
            continue;
          }
          await this.closeAndNotify(result, position.id, extremes);
          closed.push(position.id);
          this.failureBreaker.recordSuccess(position.id);
          try {
            this.extremesPort.remove(position.id);
          } catch (err) {
            this.logger.error('extremesPort.remove 失敗 - 決済は確定済（closed 維持）', {
              event: 'exit_extremes_remove_failed',
              positionId: position.id.toString(),
              error: String(err),
            });
          }
        }
      } catch (err) {
        const consecutiveFailures = this.failureBreaker.recordFailure(position.id);
        this.logger.error('ExitDispatch 失敗 - 当該戦略を skip', {
          event: 'exit_dispatch_failed',
          strategy: position.strategyName,
          positionId: position.id.toString(),
          consecutiveFailures,
          error: String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        failed.push({
          positionId: position.id,
          strategy: position.strategyName,
          errorName: err instanceof Error ? err.name : 'Unknown',
        });
      }
    }
    return ExitDispatchResult.of({ closed, skipped, failed });
  }

  private async closeAndNotify(
    cmd: ExitCommand,
    positionId: PositionId,
    extremes: ExtremesSnapshot,
  ): Promise<void> {
    await this.exitExecution.closePosition(cmd, extremes);

    try {
      await this.uiNotifier.notifyExitExecuted(cmd);
    } catch (err) {
      this.logger.error('決済通知失敗', {
        event: 'exit_notify_failed',
        positionId: positionId.toString(),
        error: String(err),
      });
    }
  }
}
