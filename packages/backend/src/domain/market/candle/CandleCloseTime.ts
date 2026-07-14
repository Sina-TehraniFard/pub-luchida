export class CandleCloseTime {
  private readonly value: Date;

  private constructor(date: Date) {
    this.value = new Date(date.getTime());
  }

  static of(date: Date): CandleCloseTime {
    if (!date || isNaN(date.getTime())) {
      throw new Error('CandleCloseTime: 無効な日時から生成できません');
    }
    return new CandleCloseTime(date);
  }

  toDate(): Date {
    return new Date(this.value.getTime());
  }

  equals(other: CandleCloseTime): boolean {
    return this.value.getTime() === other.value.getTime();
  }

  isAfter(other: CandleCloseTime): boolean {
    return this.value.getTime() > other.value.getTime();
  }

  isBefore(other: CandleCloseTime): boolean {
    return this.value.getTime() < other.value.getTime();
  }

  toString(): string {
    return this.value.toISOString();
  }
}
