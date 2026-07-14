import type { GmoApiMessage } from './GmoRestClient.js';

/** GMO FX API のビジネスステータス: レート制限超過 */
export const GMO_STATUS_RATE_LIMIT = 4;

/** HTTP 429 (Too Many Requests) もレート制限として扱うためのメッセージコード */
const GMO_HTTP_TOO_MANY_REQUESTS_MESSAGE_CODE = 'HTTP_429';

/** GMO FX API の認証失敗を表すメッセージコード（ERR-5012 等） */
const GMO_AUTH_FAILED_MESSAGE_CODES = new Set(['ERR-5012']);

/**
 * GMO FX API 固有のエラー。
 * adapter 層の内部で使い、各 Adapter がドメインエラーに変換する。
 *
 * statusCode は GMO のビジネスステータス（0=正常, 4=レート制限）であり HTTP
 * ステータスではない。認証失敗は statusCode ではなく apiMessages の
 * message_code（ERR-5012 等）として運ばれる。
 */
export class GmoApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly apiMessages: GmoApiMessage[],
  ) {
    const detail =
      apiMessages.map((m) => m.message_string).join(', ') ||
      `status=${statusCode}`;
    super(detail);
    this.name = 'GmoApiError';
  }

  /**
   * レート制限超過か。
   * GMO 通常形式のビジネスステータス（status=4）に加え、HTTP 429
   * （response.ok===false 経由で statusCode=-1, message_code=HTTP_429 に
   * 変換される）も同じレート制限として扱う。
   */
  isRateLimited(): boolean {
    return (
      this.statusCode === GMO_STATUS_RATE_LIMIT ||
      this.apiMessages.some(
        (m) => m.message_code === GMO_HTTP_TOO_MANY_REQUESTS_MESSAGE_CODE,
      )
    );
  }

  /** 認証失敗（API キー・署名不正）か */
  isAuthenticationFailed(): boolean {
    return this.apiMessages.some((m) => GMO_AUTH_FAILED_MESSAGE_CODES.has(m.message_code));
  }
}
