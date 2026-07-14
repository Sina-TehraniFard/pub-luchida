/**
 * 認証を伴う試行の結果（こと／イベント）。成功 or 失敗の 2 値のみ。
 *
 * 定期 sync が認証を伴う private API を叩いた結果を、この単位で番人に報告する。
 * boolean を排除し `report(AuthAttemptOutcome.failed())` のように業務語で読めるようにする。
 * 出典: #290 Step2。
 */
export class AuthAttemptOutcome {
  private constructor(private readonly failure: boolean) {}

  /** 認証が通った */
  static succeeded(): AuthAttemptOutcome {
    return new AuthAttemptOutcome(false);
  }

  /** 認証に失敗した */
  static failed(): AuthAttemptOutcome {
    return new AuthAttemptOutcome(true);
  }

  isFailure(): boolean {
    return this.failure;
  }
}
