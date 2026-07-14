export class Timestamp {
  private constructor(private readonly value: Date) {}

  static of(date: Date): Timestamp {
    if (!date || isNaN(date.getTime())) {
      throw new Error('Timestamp: 無効な日時から生成できません');
    }
    return new Timestamp(new Date(date.getTime()));
  }

  static now(): Timestamp {
    return new Timestamp(new Date());
  }

  toDate(): Date {
    return new Date(this.value.getTime());
  }

  equals(other: Timestamp): boolean {
    return this.value.getTime() === other.value.getTime();
  }

  isBefore(other: Timestamp): boolean {
    return this.value.getTime() < other.value.getTime();
  }

  isAfter(other: Timestamp): boolean {
    return this.value.getTime() > other.value.getTime();
  }

  toString(): string {
    return this.value.toISOString();
  }
}
