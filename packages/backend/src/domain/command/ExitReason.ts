/**
 * 決済根拠。
 * ExitRule がなぜ決済を判断したかの理由を表す値オブジェクト。
 * ログ・UI 表示・監査記録に使う。
 */
export class ExitReason {
  private constructor(private readonly value: string) {}

  static of(value: string): ExitReason {
    if (value.trim() === '') {
      throw new Error('ExitReason は空文字列にできません');
    }
    return new ExitReason(value);
  }

  toString(): string {
    return this.value;
  }

  equals(other: ExitReason): boolean {
    return this.value === other.value;
  }
}
