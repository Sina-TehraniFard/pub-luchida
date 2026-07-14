/**
 * 注文実行に関するドメインエラー。
 * Adapter 層が外部 API 固有のエラーをこの型に変換して throw する。
 */
export class BrokerError extends Error {
  private constructor(
    message: string,
    readonly code: BrokerErrorCode,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BrokerError';
  }

  static authenticationFailed(cause?: unknown): BrokerError {
    return new BrokerError('認証に失敗した', 'AUTHENTICATION_FAILED', cause);
  }

  static orderRejected(reason: string, cause?: unknown): BrokerError {
    return new BrokerError(`注文が拒否された: ${reason}`, 'ORDER_REJECTED', cause);
  }

  static executionTimeout(orderId: string): BrokerError {
    return new BrokerError(
      `約定を確認できなかった: orderId=${orderId}`,
      'EXECUTION_TIMEOUT',
    );
  }

  static rateLimited(cause?: unknown): BrokerError {
    return new BrokerError('レート制限に到達した', 'RATE_LIMITED', cause);
  }

  static networkError(cause?: unknown): BrokerError {
    return new BrokerError('通信エラーが発生した', 'NETWORK_ERROR', cause);
  }

  static unexpected(message: string, cause?: unknown): BrokerError {
    return new BrokerError(message, 'UNEXPECTED', cause);
  }

  /** 認証失敗か。「何が認証失敗か」の知識を BrokerError に閉じる（#290 Step2） */
  isAuthenticationFailure(): boolean {
    return this.code === 'AUTHENTICATION_FAILED';
  }
}

export type BrokerErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'ORDER_REJECTED'
  | 'EXECUTION_TIMEOUT'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'UNEXPECTED';
