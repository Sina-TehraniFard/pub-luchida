import { describe, it, expect } from 'vitest';
import { GmoRestClient } from '../../../src/adapter/gmo/GmoRestClient.js';

/**
 * 結合テスト: GmoRestClient → GMO FX API（実接続）
 *
 * 実行条件:
 * - .env に GMO_API_KEY, GMO_API_SECRET を設定済み
 * - npm run test:integration で実行
 */
describe('GmoRestClient 結合テスト', () => {
  const apiKey = process.env.GMO_API_KEY ?? '';
  const apiSecret = process.env.GMO_API_SECRET ?? '';

  const client = new GmoRestClient(apiKey, apiSecret);

  it('Public API で USD_JPY のレートを取得できる', async () => {
    // When: ticker を取得
    const response = await client.publicGet<unknown[]>('/public/v1/ticker', {
      symbol: 'USD_JPY',
    });

    // Then: status=0 でデータが返る
    expect(response.status).toBe(0);
    expect(response.data).toBeDefined();
  });

  it('HMAC-SHA256 署名が正しく生成され認証が通る', async () => {
    if (!apiKey || !apiSecret) {
      console.log('API キーが未設定のためスキップ');
      return;
    }

    // When: Private API を呼ぶ（建玉一覧は副作用なし）
    const response = await client.get<unknown>('/private/v1/openPositions');

    // Then: 認証が通り status=0 が返る
    expect(response.status).toBe(0);
  });
});
