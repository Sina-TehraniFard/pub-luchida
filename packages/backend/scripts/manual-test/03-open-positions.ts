/**
 * テスト03: 建玉一覧を取得する（Private API 認証確認）
 * 入金不要。認証が通れば成功。
 *
 * 実行: node --env-file=.env --import tsx scripts/manual-test/03-open-positions.ts
 */
import { GmoRestClient } from '../../src/adapter/gmo/GmoRestClient.js';

const client = new GmoRestClient(
  process.env.GMO_API_KEY!,
  process.env.GMO_API_SECRET!,
);

console.log('建玉一覧を取得中...\n');

const response = await client.get<{ list: unknown[] }>('/private/v1/openPositions');

console.log('status:', response.status);
console.log('建玉数:', response.data?.list?.length ?? 0);

if (response.data?.list?.length > 0) {
  for (const pos of response.data.list) {
    console.log('  ', JSON.stringify(pos));
  }
} else {
  console.log('  （建玉なし）');
}

console.log('\n✅ Private API 認証・建玉取得に成功。テスト成功。');
