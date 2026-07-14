/**
 * 口座残高取得に関するドメインエラー。
 * Adapter 層が外部 API 固有のエラーをこの型に変換して throw する。
 */
export class BalancePortError extends Error {
  private constructor(
    message: string,
    readonly code: BalancePortErrorCode,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BalancePortError';
  }

  static apiFailed(cause?: unknown): BalancePortError {
    return new BalancePortError('残高取得 API が失敗した', 'API_FAILED', cause);
  }

  static malformedResponse(reason: string, cause?: unknown): BalancePortError {
    return new BalancePortError(
      `残高取得レスポンスが不正: ${reason}`,
      'MALFORMED_RESPONSE',
      cause,
    );
  }

  static unexpected(message: string, cause?: unknown): BalancePortError {
    return new BalancePortError(message, 'UNEXPECTED', cause);
  }
}

export type BalancePortErrorCode =
  | 'API_FAILED'
  | 'MALFORMED_RESPONSE'
  | 'UNEXPECTED';
