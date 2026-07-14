import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GmoBalanceAdapter } from './GmoBalanceAdapter.js';
import { Balance } from '../../domain/Balance.js';
import { Money } from '../../domain/Money.js';
import { BalancePortError } from '../../domain/error/BalancePortError.js';
import type { Clock } from '../../port/Clock.js';
import type { GmoRestClient } from './GmoRestClient.js';

class FakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return this.current; }
  advance(millis: number): void {
    this.current = new Date(this.current.getTime() + millis);
  }
}

const TTL = 5000;

function buildRestClientWith(balanceFields: string[] | { error: Error }): GmoRestClient {
  const get = vi.fn();
  if ('error' in balanceFields) {
    get.mockRejectedValue(balanceFields.error);
  } else {
    for (const balance of balanceFields) {
      get.mockResolvedValueOnce({
        status: 0,
        data: { balance },
        responsetime: '2026-05-08T00:00:00.000Z',
      });
    }
  }
  return { get } as unknown as GmoRestClient;
}

describe('GmoBalanceAdapter', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = new FakeClock(new Date('2026-05-08T00:00:00.000Z'));
  });

  describe('current()', () => {
    it('キャッシュ未取得の状態では null を返す', () => {
      // Given: 1 度も freshNow を呼んでいない
      const restClient = buildRestClientWith([]);
      const adapter = new GmoBalanceAdapter(restClient, clock, TTL);

      // When / Then
      expect(adapter.current()).toBeNull();
    });

    it('TTL 内なら最後に取得したキャッシュを返す', async () => {
      // Given
      const restClient = buildRestClientWith(['100000']);
      const adapter = new GmoBalanceAdapter(restClient, clock, TTL);
      await adapter.freshNow();
      clock.advance(TTL); // ちょうど TTL = フレッシュ判定（<=）

      // When
      const result = adapter.current();

      // Then
      expect(result).not.toBeNull();
      expect(result!.equals(Balance.of(Money.jpy('100000')))).toBe(true);
    });

    it('TTL を超えたら null を返す（キャッシュ期限切れ）', async () => {
      // Given
      const restClient = buildRestClientWith(['100000']);
      const adapter = new GmoBalanceAdapter(restClient, clock, TTL);
      await adapter.freshNow();
      clock.advance(TTL + 1);

      // When / Then
      expect(adapter.current()).toBeNull();
    });
  });

  describe('freshNow()', () => {
    it('キャッシュがフレッシュなら API を叩かずキャッシュ値を返す', async () => {
      // Given
      const restClient = buildRestClientWith(['100000']);
      const adapter = new GmoBalanceAdapter(restClient, clock, TTL);
      await adapter.freshNow();

      // When: TTL 内に再度呼ぶ
      clock.advance(TTL - 1);
      const result = await adapter.freshNow();

      // Then: API 呼び出しは初回 1 回のみ
      expect(restClient.get).toHaveBeenCalledTimes(1);
      expect(result.equals(Balance.of(Money.jpy('100000')))).toBe(true);
    });

    it('キャッシュ期限切れなら API を叩いて新しい値を返す', async () => {
      // Given
      const restClient = buildRestClientWith(['100000', '120000']);
      const adapter = new GmoBalanceAdapter(restClient, clock, TTL);
      await adapter.freshNow();

      // When: TTL を超えてから呼ぶ
      clock.advance(TTL + 1);
      const result = await adapter.freshNow();

      // Then
      expect(restClient.get).toHaveBeenCalledTimes(2);
      expect(result.equals(Balance.of(Money.jpy('120000')))).toBe(true);
    });

    it('API エラー時は BalancePortError(API_FAILED) を throw する（フォールバックしない）', async () => {
      // Given: API が必ず失敗する
      const apiErr = new Error('GMO API down');
      const restClient = buildRestClientWith({ error: apiErr });
      const adapter = new GmoBalanceAdapter(restClient, clock, TTL);

      // When / Then
      try {
        await adapter.freshNow();
        expect.fail('throw されなかった');
      } catch (err) {
        expect(err).toBeInstanceOf(BalancePortError);
        expect((err as BalancePortError).code).toBe('API_FAILED');
        expect((err as BalancePortError).cause).toBe(apiErr);
      }
    });

    it('GMO FX の残高取得エンドポイント /private/v1/account/assets を叩く', async () => {
      // #238 回帰防止: 暗号資産側パス /account/margin を叩くと 404 になりエントリーが
      // 全件中断される。FX 側の正しいパスを叩いていることを CI で常時検証する
      // （結合テストは API キー未設定時に skip されるため、パス回帰はここで守る）。
      const restClient = buildRestClientWith(['100000']);
      const adapter = new GmoBalanceAdapter(restClient, clock, TTL);

      await adapter.freshNow();

      expect(restClient.get).toHaveBeenCalledWith('/private/v1/account/assets');
    });
  });

  describe('責務境界', () => {
    it('CAPITAL 由来のフォールバックを返さない（API 失敗時は null/throw のみ）', async () => {
      // Given: API 失敗
      const restClient = buildRestClientWith({ error: new Error('boom') });
      const adapter = new GmoBalanceAdapter(restClient, clock, TTL);

      // When / Then: current は null、freshNow は BalancePortError
      expect(adapter.current()).toBeNull();
      await expect(adapter.freshNow()).rejects.toBeInstanceOf(BalancePortError);
    });
  });

  describe('cacheTtlMillis バリデーション', () => {
    it('0 を渡すと throw する', () => {
      // Given / When / Then
      expect(() => new GmoBalanceAdapter(buildRestClientWith([]), clock, 0)).toThrow();
    });

    it('負数を渡すと throw する', () => {
      // Given / When / Then
      expect(() => new GmoBalanceAdapter(buildRestClientWith([]), clock, -1)).toThrow();
    });

    it('小数を渡すと throw する', () => {
      // Given / When / Then
      expect(() => new GmoBalanceAdapter(buildRestClientWith([]), clock, 1.5)).toThrow();
    });
  });

  describe('並行 freshNow', () => {
    it('同時呼び出しでも API は 1 回しか叩かれない（in-flight Promise 共有）', async () => {
      // Given: API レスポンスが解決するまで待たせる
      let resolveGet: ((v: unknown) => void) | undefined;
      const get = vi.fn().mockReturnValueOnce(new Promise((resolve) => {
        resolveGet = resolve;
      }));
      const restClient = { get } as unknown as GmoRestClient;
      const adapter = new GmoBalanceAdapter(restClient, clock, TTL);

      // When: 2 並列呼び出し
      const p1 = adapter.freshNow();
      const p2 = adapter.freshNow();
      // 両 Promise が pending 状態のまま 1 つの API レスポンスで解決される
      resolveGet!({
        status: 0,
        data: { balance: '100000' },
        responsetime: '2026-05-08T00:00:00.000Z',
      });
      const [b1, b2] = await Promise.all([p1, p2]);

      // Then: API 呼び出しは 1 回、両者は同じ Balance
      expect(get).toHaveBeenCalledTimes(1);
      expect(b1.equals(Balance.of(Money.jpy('100000')))).toBe(true);
      expect(b2.equals(b1)).toBe(true);
    });

    it('inflight 解決後に再度呼ばれた場合はキャッシュから返す（API 1 回）', async () => {
      // Given
      const restClient = buildRestClientWith(['100000']);
      const adapter = new GmoBalanceAdapter(restClient, clock, TTL);
      await adapter.freshNow();

      // When
      await adapter.freshNow();

      // Then
      expect(restClient.get).toHaveBeenCalledTimes(1);
    });
  });
});
