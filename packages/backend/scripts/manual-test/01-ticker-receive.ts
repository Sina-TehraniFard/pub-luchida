/**
 * テスト01: WebSocket で ticker を受信する
 * 入金不要。市場オープン中に実行。
 *
 * 実行: node --env-file=.env --import tsx scripts/manual-test/01-ticker-receive.ts
 */
import { GmoWebSocketClient } from '../../src/adapter/gmo/GmoWebSocketClient.js';
import { GmoMarketDataAdapter } from '../../src/adapter/gmo/GmoMarketDataAdapter.js';

const ws = new GmoWebSocketClient('wss://forex-api.coin.z.com/ws/public/v1');
const adapter = new GmoMarketDataAdapter(ws, 'USD_JPY');

let count = 0;

adapter.subscribe((tick) => {
  count++;
  console.log(`[tick #${count}] ask=${tick.ask()} bid=${tick.bid()} spread=${tick.spread()} time=${tick.timestamp()}`);
  if (count >= 5) {
    console.log('\n✅ 5件の ticker を正常受信。テスト成功。');
    adapter.disconnect();
    process.exit(0);
  }
});

adapter.onError((err) => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});

console.log('ticker 受信を開始（5件で停止）...\n');
await adapter.connect();

// 30秒でタイムアウト
setTimeout(() => {
  console.error('❌ タイムアウト（30秒）。市場がクローズ中の可能性。');
  adapter.disconnect();
  process.exit(1);
}, 30_000);
