import { describe, it, expect } from 'vitest';
import { GmoWebSocketClient } from '../../../src/adapter/gmo/GmoWebSocketClient.js';
import { GmoMarketDataAdapter } from '../../../src/adapter/gmo/GmoMarketDataAdapter.js';
import type { Tick } from '../../../src/domain/market/tick/Tick.js';

/**
 * 結合テスト: GmoMarketDataAdapter → GMO FX Public WebSocket（実接続）
 *
 * 実行条件:
 * - 市場オープン中（平日。週末は ticker が届かない可能性あり）
 * - npm run test:integration で実行
 */
describe('GmoMarketDataAdapter 結合テスト', () => {
  it('WebSocket で USD_JPY の ticker を受信できる', async () => {
    const wsClient = new GmoWebSocketClient(
      'wss://forex-api.coin.z.com/ws/public/v1',
    );
    const adapter = new GmoMarketDataAdapter(wsClient, 'USD_JPY');

    try {
      await adapter.connect();

      // 最初の tick を待つ（最大10秒）
      const tick = await new Promise<Tick>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('tick 受信タイムアウト（10秒）')),
          10_000,
        );
        adapter.subscribe((t) => {
          clearTimeout(timeout);
          resolve(t);
        });
      });

      // tick が正しい Tick オブジェクトであること
      expect(tick.ask()).toBeDefined();
      expect(tick.bid()).toBeDefined();
      expect(tick.timestamp()).toBeDefined();
    } finally {
      await adapter.disconnect();
    }
  });
});
