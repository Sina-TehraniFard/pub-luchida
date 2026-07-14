/**
 * テスト02: klines API でローソク足を取得する
 * 入金不要。いつでも実行可能。
 *
 * 実行: node --env-file=.env --import tsx scripts/manual-test/02-klines-fetch.ts
 */
import { GmoRestClient } from '../../src/adapter/gmo/GmoRestClient.js';
import { GmoCandleHistoryAdapter } from '../../src/adapter/gmo/GmoCandleHistoryAdapter.js';
import { TimeFrame } from '../../src/domain/market/TimeFrame.js';

const client = new GmoRestClient('', '');
const adapter = new GmoCandleHistoryAdapter(client);

console.log('=== 1分足 5本 ===');
const m1 = await adapter.fetchRecent(TimeFrame.ONE_MINUTE, 5);
for (const c of m1) {
  console.log(`  ${c.openTime} O=${c.open} H=${c.high} L=${c.low} C=${c.close}`);
}

console.log('\n=== 1時間足 3本 ===');
const h1 = await adapter.fetchRecent(TimeFrame.ONE_HOUR, 3);
for (const c of h1) {
  console.log(`  ${c.openTime} O=${c.open} H=${c.high} L=${c.low} C=${c.close}`);
}

console.log('\n=== 日足 3本 ===');
const d1 = await adapter.fetchRecent(TimeFrame.ONE_DAY, 3);
for (const c of d1) {
  console.log(`  ${c.openTime} O=${c.open} H=${c.high} L=${c.low} C=${c.close}`);
}

console.log('\n✅ 全時間足のローソク足を正常取得。テスト成功。');
