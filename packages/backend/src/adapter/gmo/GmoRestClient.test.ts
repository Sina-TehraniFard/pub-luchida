import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GmoRestClient } from './GmoRestClient.js';
import { GmoApiError } from './GmoApiError.js';

// Logger の console 出力を抑制
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('GmoRestClient', () => {
  const API_KEY = 'test-api-key';
  const API_SECRET = 'test-api-secret';
  let client: GmoRestClient;

  beforeEach(() => {
    client = new GmoRestClient(API_KEY, API_SECRET, 'https://example.com');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('createSignature()', () => {
    it('HMAC-SHA256 で署名を生成する', () => {
      // Given: 固定のパラメータ
      const timestamp = '1234567890';
      const method = 'POST';
      const path = '/private/v1/speedOrder';
      const body = '{"symbol":"USD_JPY"}';

      // When: 署名を生成
      const sign = client.createSignature(timestamp, method, path, body);

      // Then: 16進数文字列が返る（SHA256 = 64文字）
      expect(sign).toMatch(/^[0-9a-f]{64}$/);
    });

    it('同じ入力には同じ署名を返す', () => {
      const args = ['12345', 'GET', '/path', ''] as const;

      const sign1 = client.createSignature(...args);
      const sign2 = client.createSignature(...args);

      expect(sign1).toBe(sign2);
    });

    it('異なる入力には異なる署名を返す', () => {
      const sign1 = client.createSignature('1', 'GET', '/a', '');
      const sign2 = client.createSignature('2', 'GET', '/a', '');

      expect(sign1).not.toBe(sign2);
    });
  });

  describe('get()', () => {
    it('認証ヘッダー付きで GET リクエストを送信する', async () => {
      // Given: 正常レスポンスを返すモック
      const mockResponse = { status: 0, data: { result: true }, responsetime: '' };
      const fetchMock = vi.fn().mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });
      vi.stubGlobal('fetch', fetchMock);

      // When: GET を実行
      const result = await client.get('/private/v1/openPositions', { symbol: 'USD_JPY' });

      // Then: fetch が正しいヘッダーで呼ばれている
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/private/v1/openPositions');
      expect(url).toContain('symbol=USD_JPY');
      expect(options.method).toBe('GET');
      expect(options.headers['API-KEY']).toBe(API_KEY);
      expect(options.headers['API-TIMESTAMP']).toBeDefined();
      expect(options.headers['API-SIGN']).toBeDefined();
      expect(result.data).toEqual({ result: true });
    });
  });

  describe('post()', () => {
    it('認証ヘッダーと JSON ボディ付きで POST リクエストを送信する', async () => {
      // Given: 正常レスポンスを返すモック
      const mockResponse = { status: 0, data: { orderId: '999' }, responsetime: '' };
      const fetchMock = vi.fn().mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });
      vi.stubGlobal('fetch', fetchMock);

      // When: POST を実行
      const body = { symbol: 'USD_JPY', side: 'BUY', size: '100' };
      const result = await client.post('/private/v1/speedOrder', body);

      // Then: fetch が正しく呼ばれている
      const [, options] = fetchMock.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
      expect(result.data).toEqual({ orderId: '999' });
    });
  });

  describe('publicGet()', () => {
    it('認証なしで GET リクエストを送信する', async () => {
      // Given: 正常レスポンスを返すモック
      const mockResponse = { status: 0, data: [], responsetime: '' };
      const fetchMock = vi.fn().mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });
      vi.stubGlobal('fetch', fetchMock);

      // When: publicGet を実行
      await client.publicGet('/public/v1/klines', { symbol: 'USD_JPY' });

      // Then: 認証ヘッダーがない
      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers).toBeUndefined();
    });

    it('タイムアウト用の AbortSignal を付けて送信する', async () => {
      // Given: 正常レスポンスを返すモック
      const mockResponse = { status: 0, data: [], responsetime: '' };
      const fetchMock = vi.fn().mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });
      vi.stubGlobal('fetch', fetchMock);

      // When
      await client.publicGet('/public/v1/klines', { symbol: 'USD_JPY' });

      // Then: 無制限ハングを防ぐため signal が渡る
      const [, options] = fetchMock.mock.calls[0];
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('エラーハンドリング', () => {
    it('status !== 0 のレスポンスで BrokerError を throw する', async () => {
      // Given: エラーレスポンス
      const mockResponse = {
        status: 5,
        data: {},
        responsetime: '',
        messages: [{ message_code: 'ERR-5001', message_string: '証拠金不足' }],
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      }));

      // When & Then: GmoApiError が throw される
      await expect(client.post('/private/v1/speedOrder', {})).rejects.toThrow(GmoApiError);
    });

    it('HTTP ステータス異常（response.ok === false）で GmoApiError を throw する', async () => {
      // Given: GMO 通常形式でない 404 レスポンス
      const body = JSON.stringify({ status_code: 404, message: 'Not Found' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve(body),
      }));

      // When & Then: HTTP ステータスを反映した GmoApiError が throw される
      await expect(client.get('/private/v1/unknown')).rejects.toMatchObject({
        name: 'GmoApiError',
        apiMessages: [{ message_code: 'HTTP_404', message_string: body }],
      });
    });

    it('HTTP エラー時に HTTP ステータスと生ボディ先頭をログに残す', async () => {
      // Given: 404 レスポンスと error ログの監視
      const body = JSON.stringify({ status_code: 404, message: 'Not Found' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve(body),
      }));
      const errorSpy = vi.spyOn(console, 'error');

      // When
      await expect(client.get('/private/v1/unknown')).rejects.toThrow(GmoApiError);

      // Then: httpStatus と body が観測可能になっている
      const logged = errorSpy.mock.calls.map((c) => c.join(' ')).join(' ');
      expect(logged).toContain('HTTP エラーレスポンス');
      expect(logged).toContain('404');
      expect(logged).toContain('Not Found');
    });

    it('JSON パース失敗時、例外メッセージは生ボディ先頭 200 文字に切り詰める', async () => {
      // Given: 200 文字を超える非 JSON のレスポンス（HTML エラーページ等を想定）
      const rawBody = 'X'.repeat(300);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        text: () => Promise.resolve(rawBody),
      }));

      // When: パースに失敗する
      const error = await client.post('/private/v1/speedOrder', {}).catch((e: unknown) => e);

      // Then: 例外メッセージ（apiMessages）は先頭 200 文字に切り詰められる
      expect(error).toBeInstanceOf(GmoApiError);
      const apiError = error as GmoApiError;
      expect(apiError.apiMessages[0]?.message_code).toBe('PARSE_ERROR');
      expect(apiError.apiMessages[0]?.message_string).toBe('X'.repeat(200));

      // Then: ログ側は全体把握用に先頭 500 文字（ここでは全文 300 文字）まで残す
      const loggedBody = errorSpy.mock.calls
        .map((call) => (JSON.parse(call[0] as string) as { data?: { body?: string } }).data?.body)
        .find((body) => body !== undefined);
      expect(loggedBody).toBe('X'.repeat(300));
    });
  });

  describe('POST スロットリング', () => {
    it('1秒以内の連続 POST を待機させる', async () => {
      // Given: 2回連続で POST する
      const mockResponse = { status: 0, data: {}, responsetime: '' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      }));

      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      await client.post('/test', {});

      // When: 500ms 後に2回目の POST を開始
      vi.setSystemTime(new Date('2026-01-01T00:00:00.500Z'));
      const postPromise = client.post('/test', {});

      // Then: タイマーを進めると完了する
      await vi.advanceTimersByTimeAsync(500);
      await postPromise;

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });
  });

  describe('Public GET スロットリング', () => {
    it('1秒間に6回を超える連続 Public GET を待機させる', async () => {
      // Given: 正常レスポンスを返すモック
      const mockResponse = { status: 0, data: [], responsetime: '' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      }));

      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      // When: 同一秒内に 6 回送る（GET の上限は 1 秒 6 回）
      for (let i = 0; i < 6; i++) {
        await client.publicGet('/public/v1/klines', { symbol: 'USD_JPY' });
      }

      // 7 回目は待機に入る
      const seventh = client.publicGet('/public/v1/klines', { symbol: 'USD_JPY' });

      // Then: タイマーを進めるまで 7 回目は送信されない
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(6);
      await vi.advanceTimersByTimeAsync(1000);
      await seventh;
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(7);
    });
  });

  describe('Public GET レート制限リトライ', () => {
    it('HTTP 429 を受けたらバックオフ後にリトライして成功する', async () => {
      // Given: 1回目は HTTP 429、2回目は正常レスポンス
      const ok = { status: 0, data: [], responsetime: '' };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: () => Promise.resolve('Too Many Requests'),
        })
        .mockResolvedValue({
          text: () => Promise.resolve(JSON.stringify(ok)),
        });
      vi.stubGlobal('fetch', fetchMock);

      // When: publicGet を実行（リトライ待機をタイマーで進める）
      const promise = client.publicGet('/public/v1/klines', { symbol: 'USD_JPY' });
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      // Then: 429 を経て再送し、最終的に成功する
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.data).toEqual([]);
    });

    it('ボディ status=4（ERR-5003）を受けたらリトライして成功する', async () => {
      // Given: 1回目はレート制限（status=4）、2回目は正常レスポンス
      const rateLimited = {
        status: 4,
        data: [],
        responsetime: '',
        messages: [{ message_code: 'ERR-5003', message_string: 'rate limit' }],
      };
      const ok = { status: 0, data: [], responsetime: '' };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          text: () => Promise.resolve(JSON.stringify(rateLimited)),
        })
        .mockResolvedValue({
          text: () => Promise.resolve(JSON.stringify(ok)),
        });
      vi.stubGlobal('fetch', fetchMock);

      // When
      const promise = client.publicGet('/public/v1/klines', { symbol: 'USD_JPY' });
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      // Then: status=4 を経て再送し、成功する
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.data).toEqual([]);
    });

    it('リトライ上限を超える HTTP 429 が続くと GmoApiError を throw する', async () => {
      // Given: 常に HTTP 429 を返す
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Too Many Requests'),
      });
      vi.stubGlobal('fetch', fetchMock);

      // When: 上限（3回）を超えるまでリトライ後に失敗する
      const promise = client.publicGet('/public/v1/klines', { symbol: 'USD_JPY' });
      const expectation = expect(promise).rejects.toMatchObject({
        name: 'GmoApiError',
        apiMessages: [{ message_code: 'HTTP_429' }],
      });
      await vi.advanceTimersByTimeAsync(1500 + 3000 + 4500);
      await expectation;

      // Then: 初回 + リトライ3回 = 4回送信
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });
});
