/**
 * エントリー根拠。
 * EntryRule がなぜエントリーを判断したかの理由を表す値オブジェクト。
 * ログ・UI 表示・監査記録に使う。
 */
export class EntryReason {
  private constructor(private readonly value: string) {}

  static of(value: string): EntryReason {
    if (value.trim() === '') {
      throw new Error('EntryReason は空文字列にできません');
    }
    return new EntryReason(value);
  }

  toString(): string {
    return this.value;
  }

  equals(other: EntryReason): boolean {
    return this.value === other.value;
  }
}
