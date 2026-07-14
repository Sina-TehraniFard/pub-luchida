/**
 * 市場データ取得に関するドメインエラー。
 * Adapter 層が外部 API 固有のエラーをこの型に変換して throw する。
 */
export class MarketDataError extends Error {
  private constructor(
    message: string,
    readonly code: MarketDataErrorCode,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MarketDataError';
  }

  static connectionFailed(cause?: unknown): MarketDataError {
    return new MarketDataError(
      'WebSocket 接続に失敗した',
      'CONNECTION_FAILED',
      cause,
    );
  }

  static disconnected(cause?: unknown): MarketDataError {
    return new MarketDataError(
      'WebSocket 接続が切断された',
      'DISCONNECTED',
      cause,
    );
  }

  static subscriptionFailed(channel: string, cause?: unknown): MarketDataError {
    return new MarketDataError(
      `チャネルの購読に失敗した: ${channel}`,
      'SUBSCRIPTION_FAILED',
      cause,
    );
  }

  static fetchFailed(reason: string, cause?: unknown): MarketDataError {
    return new MarketDataError(
      `市場データの取得に失敗した: ${reason}`,
      'FETCH_FAILED',
      cause,
    );
  }

  static unexpected(message: string, cause?: unknown): MarketDataError {
    return new MarketDataError(message, 'UNEXPECTED', cause);
  }
}

export type MarketDataErrorCode =
  | 'CONNECTION_FAILED'
  | 'DISCONNECTED'
  | 'SUBSCRIPTION_FAILED'
  | 'FETCH_FAILED'
  | 'UNEXPECTED';
