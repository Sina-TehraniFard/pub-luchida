import { AuthFailureCount } from './AuthFailureCount.js';
import { AuthFailureThreshold } from './AuthFailureThreshold.js';
import { AuthAttemptOutcome } from './AuthAttemptOutcome.js';
import { EntryAdmission } from './EntryAdmission.js';
import type { AuthFailureReportPort } from '../port/AuthFailureReportPort.js';
import type { EntryAdmissionPort } from '../port/EntryAdmissionPort.js';
import type { LogPort } from '../port/LogPort.js';

/** 番人が新規エントリーを抑止する理由ラベル（EntryAdmission.blocked に運ぶ） */
const REASON_AUTH_FAILURE = '連続認証失敗';

/**
 * 連続認証失敗の停止回路（TradingGuard 原型）。
 *
 * 定期 sync から認証試行の成否を受け取り、連続失敗を数える。閾値に達したら
 * 新規エントリーの可否を「不可」に転じ、認証成功で平常に戻す。
 *
 * - 状態: CLOSED（平常・許可）/ OPEN（発動・抑止）。状態は連続失敗カウントから導く。
 * - Exit を問う口は持たない＝Exit は構造的に止められない（「Entry は緩く、Exit は堅く」）。
 * - 通知は LogPort のみ。状態が変化した瞬間だけログを出す（連発を避ける）。
 *
 * 出典: #290 Step2。
 */
export class AuthFailureCircuitBreaker
  implements AuthFailureReportPort, EntryAdmissionPort
{
  private count: AuthFailureCount = AuthFailureCount.zero();

  constructor(
    private readonly threshold: AuthFailureThreshold,
    private readonly log: LogPort,
  ) {}

  report(outcome: AuthAttemptOutcome): void {
    const wasOpen = this.isOpen();

    if (outcome.isFailure()) {
      this.count = this.count.increment();
    } else {
      this.count = this.count.reset();
    }

    const isOpen = this.isOpen();

    // 状態が変化した瞬間だけ通知する（CLOSED 継続・OPEN 継続では無言）。
    if (!wasOpen && isOpen) {
      this.log.warn('新規エントリーを抑止（連続認証失敗が閾値に到達）', {
        consecutiveFailures: this.count.toNumber(),
        threshold: this.threshold.toNumber(),
      });
    } else if (wasOpen && !isOpen) {
      this.log.info('新規エントリーの抑止を解除（認証成功で復帰）', {});
    }
  }

  admitEntry(): EntryAdmission {
    return this.isOpen()
      ? EntryAdmission.blocked(REASON_AUTH_FAILURE)
      : EntryAdmission.permitted();
  }

  /** 抑止中（OPEN）か。連続失敗が閾値に達していれば OPEN */
  isOpen(): boolean {
    return this.count.reaches(this.threshold);
  }
}
