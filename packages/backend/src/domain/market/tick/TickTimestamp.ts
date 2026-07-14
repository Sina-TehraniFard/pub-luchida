export class TickTimestamp {
  private constructor(private readonly value: Date) {}

  static of(date: Date): TickTimestamp {
    if (!date || isNaN(date.getTime())) {
      throw new Error('TickTimestamp: 無効な日時から生成できません');
    }
    // サーバーとローカルのクロックスキューを許容（5秒）
    const CLOCK_SKEW_TOLERANCE_MS = 5_000;
    if (date.getTime() > Date.now() + CLOCK_SKEW_TOLERANCE_MS) {
      throw new Error('TickTimestamp: 未来の日時は受け付けません');
    }
    return new TickTimestamp(new Date(date.getTime())); // コピーして保持
  }

  toDate(): Date {
    return new Date(this.value.getTime()); // コピーして返す
  }

  equals(other: TickTimestamp): boolean {
    return this.value.getTime() === other.value.getTime();
  }

  isBefore(other: TickTimestamp): boolean {
    return this.value.getTime() < other.value.getTime();
  }

  isAfter(other: TickTimestamp): boolean {
    return this.value.getTime() > other.value.getTime();
  }

  toString(): string {
    return this.value.toISOString();
  }
}
