/**
 * 同一ポジションの決済失敗が何回連続したら kill-switch を発動するか、という業務閾値。
 *
 * 1 以上の整数のみ許容する（0 だと初回失敗で即停止になり「連続」の意味を失う）。
 * 発動条件はエラー種別に依存しない（認証失敗・レート制限・建玉不在いずれも
 * 「決済が恒久的に失敗する状態」として同列に数える）。
 * 出典: #186（実証事例: 2026-06-11 の決済リトライ暴走）。
 */
export class ExitFailureThreshold {
  private constructor(private readonly value: number) {}

  static of(value: number): ExitFailureThreshold {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`ExitFailureThreshold は 1 以上の整数: ${value}`);
    }
    return new ExitFailureThreshold(value);
  }

  toNumber(): number {
    return this.value;
  }

  toString(): string {
    return String(this.value);
  }
}
