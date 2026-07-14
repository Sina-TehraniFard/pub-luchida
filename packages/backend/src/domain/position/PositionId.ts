import { randomUUID } from 'node:crypto';

export class PositionId {
  private constructor(private readonly value: string) {}

  static generate(): PositionId {
    return new PositionId(randomUUID());
  }

  static from(value: string): PositionId {
    if (!value || value.trim().length === 0) {
      throw new Error('PositionId は空にできません');
    }
    return new PositionId(value);
  }

  toString(): string {
    return this.value;
  }

  equals(other: PositionId): boolean {
    return this.value === other.value;
  }

  /**
   * id 文字列の辞書順比較。
   * 評価順の決定論化（ExitDispatcher の `openedAt` 同値時の二次キー）に使う。
   * 戻り値: this < other で負、this > other で正、等価で 0。
   * 設計書: docs/design/position-manager/step8-brief.md 5.5。
   */
  compareTo(other: PositionId): number {
    if (this.value < other.value) return -1;
    if (this.value > other.value) return 1;
    return 0;
  }
}
