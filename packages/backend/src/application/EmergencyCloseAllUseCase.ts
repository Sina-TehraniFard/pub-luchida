import { ExitCommand, ExitType } from '../domain/command/ExitCommand.js';
import { ExitReason } from '../domain/command/ExitReason.js';
import type { Broker } from '../port/Broker.js';
import type { PositionRepository } from '../port/PositionRepository.js';
import type { LogPort } from '../domain/port/LogPort.js';
import { NoopLogPort } from '../domain/port/NoopLogPort.js';

/** 決済に成功したポジションの要約。 */
export interface ClosedPositionSummary {
  readonly positionId: string;
  readonly exitPrice: string;
  readonly profitLoss: string;
}

/** 緊急全決済の結果。 */
export interface EmergencyCloseAllResult {
  /** 決済対象だった OPEN ポジション数（0 = 保有なし） */
  readonly total: number;
  /** 決済成立 + DB 反映まで完了したポジション */
  readonly closed: readonly ClosedPositionSummary[];
  /** 失敗が確定したポジション（メッセージに失敗段階を含む） */
  readonly errors: readonly string[];
  /**
   * タイムアウト打ち切り時点で結果未確定のポジション id。
   * 操作者はブローカー側の画面で建玉を確認すること。
   * DB 反映の遅れは次回 sync で収束する。
   */
  readonly unresolved: readonly string[];
}

/**
 * 保有中の全ポジションを成行で即時決済する UseCase。
 * UI の緊急全決済操作（POST /api/emergency-close-all）から呼ばれる。
 *
 * 方針:
 * - 各ポジションの決済は並列実行し、1 件の失敗で他を止めない
 *   （緊急時は「閉じられるものから閉じる」が正。sync の fail-fast とは逆の判断）
 * - 全体にタイムアウトを設け、ブローカー API の応答遅延でリクエストを
 *   無期限に塞がない。タイムアウト後も決済注文自体は取り消されないため、
 *   DB 反映の遅れは次回 sync / Exit 監視で収束する
 *   （前提: sync が対象ペアをカバーしていること。現状は単一ペア運用で成立。
 *   ペア追加時は SyncPositionsUseCase の対象ペアと合わせて見直すこと）
 * - 再入ガード: 前回の決済注文が in-flight の間は再実行を拒否する。
 *   二重決済はブローカー側の数量拘束でも弾かれるが、
 *   ブローカー仕様に安全性を外注しない（ブローカー非依存設計）
 *
 * 設計書: docs/design/sequence/core/usecase-layer.md「緊急全決済」
 */
/** 前回の決済注文が未決着のまま再実行されたことを表すエラー（HTTP 409 相当）。 */
export class EmergencyCloseInProgressError extends Error {
  constructor() {
    super('緊急全決済は既に実行中です（前回の決済注文が完了していません）');
    this.name = 'EmergencyCloseInProgressError';
  }
}

export class EmergencyCloseAllUseCase {
  private inFlight = false;

  constructor(
    private readonly broker: Broker,
    private readonly positionRepository: PositionRepository,
    private readonly logger: LogPort = NoopLogPort,
    private readonly timeoutMs: number = 30_000,
  ) {}

  async execute(): Promise<EmergencyCloseAllResult> {
    if (this.inFlight) {
      throw new EmergencyCloseInProgressError();
    }
    this.inFlight = true;

    let openPositions;
    try {
      openPositions = await this.positionRepository.openPositions();
    } catch (err) {
      this.inFlight = false;
      throw err;
    }
    if (openPositions.isEmpty()) {
      this.inFlight = false;
      return { total: 0, closed: [], errors: [], unresolved: [] };
    }

    const closed: ClosedPositionSummary[] = [];
    const errors: string[] = [];
    const settledIds = new Set<string>();

    const closePromises: Promise<void>[] = [];
    openPositions.forEach((position) => {
      const positionId = position.id.toString();
      const closeOne = async () => {
        try {
          let exitResult;
          try {
            exitResult = await this.broker.placeExit(position);
          } catch (err) {
            // 発注段階の失敗: ポジションは建ったままの可能性がある
            this.logger.error('緊急決済の発注に失敗', { positionId, error: String(err) });
            errors.push(`${positionId}: 発注失敗 - ${String(err)}`);
            return;
          }

          const exitCommand = ExitCommand.of({
            positionId: position.id,
            type: ExitType.FORCE_CLOSE,
            reason: ExitReason.of('緊急全決済'),
          });
          try {
            position.close(exitCommand, exitResult);
            await this.positionRepository.update(position);
          } catch (err) {
            // 決済はブローカーで成立済み。状態遷移 / DB 反映の遅れは次回 sync で収束する
            this.logger.error('緊急決済は成立したが状態遷移または DB 更新に失敗', { positionId, error: String(err) });
            errors.push(`${positionId}: 決済成立済み・状態遷移/DB 更新失敗（次回 sync で収束） - ${String(err)}`);
            return;
          }

          closed.push({
            positionId,
            exitPrice: exitResult.exitPrice.toString(),
            profitLoss: exitResult.profitLoss.toString(),
          });
        } catch (err) {
          // 防御: 内側で捕捉しない例外（ExitCommand 生成 / Position.close 等）も
          // 必ず errors に現れる不変条件を守る（total = closed + errors + unresolved）
          this.logger.error('緊急決済で想定外のエラー', { positionId, error: String(err) });
          errors.push(`${positionId}: ${String(err)}`);
        } finally {
          settledIds.add(positionId);
        }
      };
      closePromises.push(closeOne());
    });

    // in-flight ガードはタイムアウト返却後も「全決済注文の決着」まで保持する
    const allSettled = Promise.allSettled(closePromises);
    void allSettled.finally(() => {
      this.inFlight = false;
    });

    // 全決済の完了を待つ（タイムアウト超過時は途中結果で打ち切り）
    let timeoutId: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`緊急全決済タイムアウト（${this.timeoutMs / 1000}秒）`)),
        this.timeoutMs,
      );
    });
    try {
      await Promise.race([allSettled, timeout]);
    } catch (err) {
      this.logger.error('緊急全決済タイムアウト', { error: String(err) });
    } finally {
      clearTimeout(timeoutId);
    }

    // タイムアウト時点で決着していないポジションは「結果不明」として明示する
    const unresolved: string[] = [];
    openPositions.forEach((position) => {
      if (!settledIds.has(position.id.toString())) {
        unresolved.push(position.id.toString());
      }
    });
    if (unresolved.length > 0) {
      this.logger.error('緊急全決済で結果未確定のポジションあり。ブローカー側で建玉を確認すること', {
        unresolved,
      });
    }

    this.logger.warn('緊急全決済実行', {
      total: openPositions.count(),
      closed: closed.length,
      errors: errors.length,
      unresolved: unresolved.length,
    });

    // in-flight タスクが返却後に配列を変異させないようスナップショットを返す
    return {
      total: openPositions.count(),
      closed: [...closed],
      errors: [...errors],
      unresolved,
    };
  }
}
