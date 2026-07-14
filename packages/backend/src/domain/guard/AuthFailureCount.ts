import { AuthFailureThreshold } from './AuthFailureThreshold.js';

/**
 * いま連続して何回認証に失敗しているか。
 *
 * 「連続」とは「間に一度も成功を挟まない」回数を指す。成功報告が入ったら reset() で 0 に戻る。
 * 不変オブジェクト。increment() / reset() は新インスタンスを返す。
 * 出典: #290 Step2。
 */
export class AuthFailureCount {
  private constructor(private readonly value: number) {}

  /** 連続失敗ゼロ（起動直後・成功直後の状態） */
  static zero(): AuthFailureCount {
    return new AuthFailureCount(0);
  }

  /** 失敗を 1 回数える（新インスタンス） */
  increment(): AuthFailureCount {
    return new AuthFailureCount(this.value + 1);
  }

  /** 連続をゼロに戻す（新インスタンス） */
  reset(): AuthFailureCount {
    return AuthFailureCount.zero();
  }

  /** 閾値に達した（以上）か */
  reaches(threshold: AuthFailureThreshold): boolean {
    return this.value >= threshold.toNumber();
  }

  toNumber(): number {
    return this.value;
  }
}
