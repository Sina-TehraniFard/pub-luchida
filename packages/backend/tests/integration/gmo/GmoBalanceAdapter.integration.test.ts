import { describe, it, expect } from 'vitest';
import { GmoRestClient } from '../../../src/adapter/gmo/GmoRestClient.js';
import { GmoBalanceAdapter } from '../../../src/adapter/gmo/GmoBalanceAdapter.js';
import { SystemClock } from '../../../src/infrastructure/time/SystemClock.js';

/**
 * 結合テスト: GmoBalanceAdapter → GMO FX Private REST API（実接続）
 *
 * 実行条件:
 * - .env に GMO_API_KEY, GMO_API_SECRET を設定済み
 * - npm run test:integration で実行
 *
 * 背景（#238）:
 * 残高取得が存在しない `/private/v1/account/margin`（GMO 暗号資産側パス）を叩いて 404 になり、
 * エントリーが全件中断されていた。正しい FX パス `/private/v1/account/assets` を実 API で叩き、
 * 残高が取得できることをこのテストで担保する（単体テストはモックのためパス誤りを検知できない）。
 */
describe('GmoBalanceAdapter 結合テスト', () => {
  const apiKey = process.env.GMO_API_KEY ?? '';
  const apiSecret = process.env.GMO_API_SECRET ?? '';

  const client = new GmoRestClient(apiKey, apiSecret);
  const adapter = new GmoBalanceAdapter(client, new SystemClock(), 5_000);

  // API キー未設定時はスキップとして明示（テストレポートで実行有無を追跡できる）
  it.skipIf(!apiKey || !apiSecret)('freshNow で残高を取得できる（実 API）', async () => {
    // When: 鮮度保証で残高を取得（/private/v1/account/assets を叩く）
    const balance = await adapter.freshNow();

    // Then: Balance が返り、純残高は 0 以上の数値として読み取れる
    const amount = balance.toMoney().toBig().toNumber();
    expect(Number.isFinite(amount)).toBe(true);
    expect(amount).toBeGreaterThanOrEqual(0);
  });
});
