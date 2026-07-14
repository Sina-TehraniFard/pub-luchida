import type { CurrencyPair } from '../market/CurrencyPair.js';

/**
 * `RatePort` の鮮度保証経路（`currentFresh`）が失敗したことを表すドメインエラー。
 *
 * Adapter 層が tick 未到着・鮮度切れを検出した際に、Adapter 固有のエラーをこの型に
 * 変換して throw する。`PositionSizingService` 側はこの専用例外で発注中止判断ができる。
 *
 * 設計書: docs/design/position-manager/policies.md 4.4 P6（増田亨判定）。
 */
export class RatePortError extends Error {
  private constructor(
    message: string,
    readonly code: RatePortErrorCode,
    readonly pair: CurrencyPair,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RatePortError';
  }

  static notYetAvailable(pair: CurrencyPair, cause?: unknown): RatePortError {
    return new RatePortError(
      `Rate がまだ届いていない（初回 tick 未到着）: ${pair}`,
      'NOT_YET_AVAILABLE',
      pair,
      cause,
    );
  }

  static stale(pair: CurrencyPair, ageMillis: number, maxAgeMillis: number, cause?: unknown): RatePortError {
    return new RatePortError(
      `Rate が鮮度切れ: ${pair} age=${ageMillis}ms max=${maxAgeMillis}ms`,
      'STALE',
      pair,
      cause,
    );
  }

  static pairMismatch(expected: CurrencyPair, actual: CurrencyPair): RatePortError {
    return new RatePortError(
      `RatePort にバインドされていない通貨ペアが要求された: bound=${expected} requested=${actual}`,
      'PAIR_MISMATCH',
      actual,
    );
  }
}

export type RatePortErrorCode =
  | 'NOT_YET_AVAILABLE'
  | 'STALE'
  | 'PAIR_MISMATCH';
