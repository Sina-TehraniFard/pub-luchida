import { createHmac } from 'node:crypto';
import { Logger } from '../../infrastructure/logging/Logger.js';
import { GmoApiError, GMO_STATUS_RATE_LIMIT } from './GmoApiError.js';

const RATE_LIMIT_STATUS = GMO_STATUS_RATE_LIMIT;
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = 1500;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * GMO FX REST API との HTTP 通信を担う。
 * HMAC-SHA256 署名の生成、スロットリング、レート制限リトライを管理する。
 */
export class GmoRestClient {
  private readonly logger = new Logger('GmoRestClient', 'BROKER');
  private lastPostTimestamp = 0;
  private readonly getTimestamps: number[] = [];

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly baseUrl: string = 'https://forex-api.coin.z.com',
    private readonly requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {}

  async get<T>(path: string, params?: Record<string, string>): Promise<GmoApiResponse<T>> {
    return this.withRateLimitRetry(() => this.doGet<T>(path, params));
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<GmoApiResponse<T>> {
    return this.withRateLimitRetry(() => this.doPost<T>(path, body));
  }

  async publicGet<T>(path: string, params?: Record<string, string>): Promise<GmoApiResponse<T>> {
    // Public GET も認証 GET と同じレート制限に服する。スロットリングと
    // レート制限リトライを通し、連続発行で 429/ERR-5003 を踏まないようにする。
    return this.withRateLimitRetry(() => this.doPublicGet<T>(path, params));
  }

  private async doPublicGet<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<GmoApiResponse<T>> {
    await this.throttleGet();

    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    this.logger.info('Public GET リクエスト送信', { path });

    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    return this.handleResponse<T>(response, 'GET', path);
  }

  /**
   * HMAC-SHA256 署名を生成する。
   * 署名対象: timestamp + method + path + body
   */
  createSignature(
    timestamp: string,
    method: string,
    path: string,
    body: string,
  ): string {
    const text = timestamp + method + path + body;
    return createHmac('sha256', this.apiSecret).update(text).digest('hex');
  }

  private async doGet<T>(path: string, params?: Record<string, string>): Promise<GmoApiResponse<T>> {
    await this.throttleGet();

    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const timestamp = Date.now().toString();
    const signPath = toSignaturePath(path);
    const sign = this.createSignature(timestamp, 'GET', signPath, '');

    this.logger.info('GET リクエスト送信', { path });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'API-KEY': this.apiKey,
        'API-TIMESTAMP': timestamp,
        'API-SIGN': sign,
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    return this.handleResponse<T>(response, 'GET', path);
  }

  private async doPost<T>(path: string, body: Record<string, unknown>): Promise<GmoApiResponse<T>> {
    await this.throttlePost();

    const timestamp = Date.now().toString();
    const bodyStr = JSON.stringify(body);
    const signPath = toSignaturePath(path);
    const sign = this.createSignature(timestamp, 'POST', signPath, bodyStr);

    this.logger.info('POST リクエスト送信', { path });

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'API-KEY': this.apiKey,
        'API-TIMESTAMP': timestamp,
        'API-SIGN': sign,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    return this.handleResponse<T>(response, 'POST', path);
  }

  /**
   * レート制限エラーをバックオフ付きで自動リトライする。
   * GMO 通常形式の status=4 だけでなく HTTP 429 も対象（GmoApiError.isRateLimited
   * が両者を判定する）。それ以外のエラーはそのまま throw する。
   */
  private async withRateLimitRetry<T>(
    request: () => Promise<GmoApiResponse<T>>,
  ): Promise<GmoApiResponse<T>> {
    for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
      try {
        return await request();
      } catch (err) {
        if (
          err instanceof GmoApiError &&
          err.isRateLimited() &&
          attempt < RATE_LIMIT_MAX_RETRIES
        ) {
          const wait = RATE_LIMIT_BACKOFF_MS * (attempt + 1);
          this.logger.warn('レート制限。リトライ待機', {
            attempt: attempt + 1,
            waitMs: wait,
          });
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
    // ここには到達しないが TypeScript のために
    throw new GmoApiError(RATE_LIMIT_STATUS, []);
  }

  private async handleResponse<T>(
    response: Response,
    method: string,
    path: string,
  ): Promise<GmoApiResponse<T>> {
    const text = await response.text();

    // HTTP ステータス異常は GMO 通常形式（{status, messages, data}）でない
    // ことが多い。ボディ JSON の status 判定より先に検知し、HTTP ステータスと
    // 生ボディ先頭を残して観測可能性を確保する。
    if (response.ok === false) {
      this.logger.error('HTTP エラーレスポンス', {
        method,
        path,
        httpStatus: response.status,
        body: text.slice(0, 500),
      });
      throw new GmoApiError(-1, [
        { message_code: `HTTP_${response.status}`, message_string: text.slice(0, 200) },
      ]);
    }

    let json: GmoApiResponse<T>;
    try {
      json = JSON.parse(text) as GmoApiResponse<T>;
    } catch {
      // ログは全体把握用に長め(500)、例外メッセージは伝播用に短め(200)に切り出す
      this.logger.error('JSON パース失敗', { method, path, body: text.slice(0, 500) });
      throw new GmoApiError(-1, [{ message_code: 'PARSE_ERROR', message_string: text.slice(0, 200) }]);
    }

    if (json.status !== 0) {
      this.logger.error('API エラーレスポンス', {
        method,
        path,
        status: json.status,
        messages: json.messages,
      });
      this.throwApiError(json);
    }

    return json;
  }

  private throwApiError(response: GmoApiResponse<unknown>): never {
    throw new GmoApiError(response.status, response.messages ?? []);
  }

  /** POST: 1秒に1回制限 */
  private async throttlePost(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastPostTimestamp;
    if (elapsed < 1000) {
      const wait = 1000 - elapsed;
      this.logger.info('POST スロットリング待機', { waitMs: wait });
      await sleep(wait);
    }
    this.lastPostTimestamp = Date.now();
  }

  /** GET: 1秒間に6回制限 */
  private async throttleGet(): Promise<void> {
    const now = Date.now();
    const windowStart = now - 1000;
    while (this.getTimestamps.length > 0 && this.getTimestamps[0] <= windowStart) {
      this.getTimestamps.shift();
    }
    if (this.getTimestamps.length >= 6) {
      const oldest = this.getTimestamps[0];
      const wait = oldest + 1000 - now;
      if (wait > 0) {
        this.logger.info('GET スロットリング待機', { waitMs: wait });
        await sleep(wait);
      }
    }
    this.getTimestamps.push(Date.now());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 署名用パスを生成する。
 * GMO FX API の署名対象パスは /private を含めず /v1/... で始まる。
 */
function toSignaturePath(path: string): string {
  return path.replace(/^\/private/, '');
}

/** GMO FX API の共通レスポンス型 */
export interface GmoApiResponse<T> {
  status: number;
  data: T;
  responsetime: string;
  messages?: GmoApiMessage[];
}

export interface GmoApiMessage {
  message_code: string;
  message_string: string;
}
