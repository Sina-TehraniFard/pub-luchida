/**
 * 連続認証失敗が何回に達したら新規エントリーを抑止するか、という業務閾値。
 *
 * 1 以上の整数のみ許容する（0 だと初回失敗で即抑止になり「連続」の意味を失う）。
 * 出典: #290 Step2（連続認証失敗の停止回路）。
 */
export class AuthFailureThreshold {
  private constructor(private readonly value: number) {}

  static of(value: number): AuthFailureThreshold {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`AuthFailureThreshold は 1 以上の整数: ${value}`);
    }
    return new AuthFailureThreshold(value);
  }

  toNumber(): number {
    return this.value;
  }

  toString(): string {
    return String(this.value);
  }
}
