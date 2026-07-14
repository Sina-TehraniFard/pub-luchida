/**
 * ADX/DI 計算の期間パラメータ。
 *
 * Wilder 標準は 14。CLI からの引数で可変にするため値オブジェクトとして表現し、
 * 「正の整数」というドメイン不変条件を生成時に守る（number を素通しさせない）。
 */
export class AdxPeriod {
  /** Wilder 標準の既定期間。 */
  static readonly DEFAULT: AdxPeriod = new AdxPeriod(14);

  private constructor(private readonly value: number) {}

  static of(value: number): AdxPeriod {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`ADX 期間は正の整数: ${value}`);
    }
    return new AdxPeriod(value);
  }

  toNumber(): number {
    return this.value;
  }

  equals(other: AdxPeriod): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return String(this.value);
  }
}
