import { ExitFailureThreshold } from './ExitFailureThreshold.js';
import type { PositionId } from '../position/PositionId.js';

/** ポジション 1 件分の失敗追跡。 */
interface FailureRecord {
  /** 連続失敗回数。成功（決済確定）で記録ごと消える */
  consecutiveFailures: number;
  /** この tick に達するまで再試行を許可しない */
  cooldownUntilTick: number;
}

/** kill-switch 発動根拠。ログ・通知にそのまま載せる */
export interface KillDetail {
  readonly positionId: string;
  readonly consecutiveFailures: number;
  readonly threshold: number;
}

/**
 * 決済連続失敗の停止回路（TradingGuard 原型 / #186）。
 *
 * ExitDispatcher から試行結果を受け取り、ポジション単位で連続失敗を数える。
 * 役割は 2 段:
 * - **クールダウン**: 失敗したポジションは一定 tick 数だけ再試行を止める（API 連打の抑制）。
 *   指数バックオフではなく固定 tick 数なのは、監視・見積りのしやすさを優先した判断。
 * - **kill-switch 判定**: いずれかのポジションで連続失敗が閾値に達したら発動を宣言する。
 *   実際の停止（TradingSession.stop）は呼び出し側の責務。
 *
 * カウントのリセットは「決済成功」または「ポジションが OPEN 集合から消えた」ときのみ。
 * ExitRule が発火しなかった tick では減らない（失敗が間欠でも、成功を挟まない限り累積する）。
 *
 * 時間は wall-clock ではなく dispatch 回数（tick）で数える。tick 間隔は市場の
 * 活況に比例するため、閑散時に無駄な再試行が密になることがない。
 *
 * 前例: AuthFailureCircuitBreaker（#290 Step2）。
 */
export class ExitFailureCircuitBreaker {
  private tick = 0;
  private readonly records = new Map<string, FailureRecord>();

  constructor(
    private readonly threshold: ExitFailureThreshold,
    private readonly cooldownTicks: number,
  ) {
    if (!Number.isInteger(cooldownTicks) || cooldownTicks < 0) {
      throw new Error(`cooldownTicks は 0 以上の整数: ${cooldownTicks}`);
    }
  }

  /**
   * dispatch 1 回の開始を告げる。tick を進め、OPEN 集合から消えたポジションの
   * 記録を掃除する（決済成功・外部決済・定期 sync による CLOSED 化のいずれでも消える）。
   */
  beginTick(activeIds: readonly PositionId[]): void {
    this.tick++;
    const active = new Set(activeIds.map((id) => id.toString()));
    for (const key of this.records.keys()) {
      if (!active.has(key)) {
        this.records.delete(key);
      }
    }
  }

  /** このポジションの決済を今 tick で試行してよいか。クールダウン中は false */
  admitAttempt(id: PositionId): boolean {
    const record = this.records.get(id.toString());
    return !record || this.tick >= record.cooldownUntilTick;
  }

  /**
   * 失敗を記録し、クールダウンを開始する。戻り値は更新後の連続失敗回数
   * （呼び出し側が運用ログに載せる用途）。
   */
  recordFailure(id: PositionId): number {
    const key = id.toString();
    const consecutiveFailures = (this.records.get(key)?.consecutiveFailures ?? 0) + 1;
    this.records.set(key, {
      consecutiveFailures,
      cooldownUntilTick: this.tick + this.cooldownTicks,
    });
    return consecutiveFailures;
  }

  /** 決済成功。当該ポジションの追跡を終える */
  recordSuccess(id: PositionId): void {
    this.records.delete(id.toString());
  }

  /** いずれかのポジションで連続失敗が閾値に達しているか */
  shouldKill(): boolean {
    return this.killDetail() !== null;
  }

  /** 発動根拠（連続失敗が最多のポジション）。未達なら null */
  killDetail(): KillDetail | null {
    let worst: KillDetail | null = null;
    for (const [positionId, record] of this.records) {
      if (record.consecutiveFailures < this.threshold.toNumber()) continue;
      if (!worst || record.consecutiveFailures > worst.consecutiveFailures) {
        worst = {
          positionId,
          consecutiveFailures: record.consecutiveFailures,
          threshold: this.threshold.toNumber(),
        };
      }
    }
    return worst;
  }
}
