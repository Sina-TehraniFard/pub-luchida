import { SmaSnapshot } from './SmaSnapshot.js';

/**
 * テクニカル指標の現在値セット。
 * confirmed（確定足）と forming（形成中足）それぞれの SmaSnapshot を持つ。
 */
export class IndicatorValues {
  private constructor(
    readonly confirmed: SmaSnapshot,
    readonly forming: SmaSnapshot,
  ) {}

  static of(confirmed: SmaSnapshot, forming: SmaSnapshot): IndicatorValues {
    return new IndicatorValues(confirmed, forming);
  }

  equals(other: IndicatorValues): boolean {
    return (
      this.confirmed.equals(other.confirmed) &&
      this.forming.equals(other.forming)
    );
  }
}
