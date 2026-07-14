export class CandleOpenTime {
  private readonly value: Date;

  private constructor(date: Date) {
    this.value = new Date(date.getTime());
  }

  static of(date: Date): CandleOpenTime {
    if (!date || isNaN(date.getTime())) {
      throw new Error('CandleOpenTime: 無効な日時から生成できません');
    }
    return new CandleOpenTime(date);
  }

  toDate(): Date {
    return new Date(this.value.getTime());
  }

  equals(other: CandleOpenTime): boolean {
    return this.value.getTime() === other.value.getTime();
  }

  isBefore(other: CandleOpenTime): boolean {
    return this.value.getTime() < other.value.getTime();
  }

  isAfter(other: CandleOpenTime): boolean {
    return this.value.getTime() > other.value.getTime();
  }

  toString(): string {
    return this.value.toISOString();
  }
}
