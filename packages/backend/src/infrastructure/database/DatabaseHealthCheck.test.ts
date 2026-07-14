import { describe, it, expect, vi } from 'vitest';
import type { StartupHealthLogger } from './DatabaseHealthCheck.js';
import { DatabaseHealthCheck, DEFAULT_BACKOFF } from './DatabaseHealthCheck.js';

/** warn/error の呼び出しを記録するだけの Fake Logger（最小契約なので型キャスト不要） */
function fakeLogger() {
  const warn = vi.fn<StartupHealthLogger['warn']>();
  const error = vi.fn<StartupHealthLogger['error']>();
  const logger: StartupHealthLogger = { warn, error };
  return { ...logger, warn, error };
}

/** sleep 待機時間を記録する Fake（即時解決＝実時間を待たない） */
function fakeSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
  };
  return { sleep, delays };
}

describe('DatabaseHealthCheck', () => {
  it('初回 ping が成功すればリトライせず即座に通過する', async () => {
    // Given: 必ず成功する ping
    const ping = vi.fn(async () => {});
    const logger = fakeLogger();
    const { sleep, delays } = fakeSleep();
    const check = new DatabaseHealthCheck(ping, logger, {}, sleep);

    // When
    await check.ensureHealthy();

    // Then: 1 回だけ ping、待機なし、警告なし
    expect(ping).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('数回失敗後に成功すれば通過し、exponential backoff で待機する', async () => {
    // Given: 最初の 3 回 throw、4 回目で成功
    let calls = 0;
    const ping = vi.fn(async () => {
      calls += 1;
      if (calls <= 3) throw new Error('ECONNREFUSED');
    });
    const logger = fakeLogger();
    const { sleep, delays } = fakeSleep();
    const check = new DatabaseHealthCheck(ping, logger, {}, sleep);

    // When
    await check.ensureHealthy();

    // Then: 4 回 ping、待機は 1000 → 2000 → 4000（初期 1s / 倍率 2）
    expect(ping).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('待機時間は maxDelayMs（30s）で頭打ちになる', async () => {
    // Given: 常に throw、maxRetries だけ多めに（待機の上限挙動を見るため）
    const ping = vi.fn(async () => {
      throw new Error('down');
    });
    const logger = fakeLogger();
    const { sleep, delays } = fakeSleep();
    const check = new DatabaseHealthCheck(ping, logger, { maxRetries: 8 }, sleep);

    // When
    await expect(check.ensureHealthy()).rejects.toThrow();

    // Then: 1000,2000,4000,8000,16000,30000(=min(32000,30000)),30000,30000
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('maxRetries 回失敗するとリトライ上限で throw し error ログを出す', async () => {
    // Given: 常に throw（デフォルト maxRetries=5）
    const ping = vi.fn(async () => {
      throw new Error('boom');
    });
    const logger = fakeLogger();
    const { sleep, delays } = fakeSleep();
    const check = new DatabaseHealthCheck(ping, logger, {}, sleep);

    // When / Then
    await expect(check.ensureHealthy()).rejects.toThrow(/DB 健康度チェックに失敗/);

    // 初回 + 5 リトライ = 6 回 ping、待機は 5 回
    expect(ping).toHaveBeenCalledTimes(6);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(logger.warn).toHaveBeenCalledTimes(5);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1]).toMatchObject({
      event: 'startup_db_unhealthy',
      attempt: 6,
      totalAttempts: 6,
      maxRetries: 5,
    });
  });

  it('警告ログに startup_db_unhealthy イベント名を含める', async () => {
    // Given
    let calls = 0;
    const ping = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
    });
    const logger = fakeLogger();
    const { sleep } = fakeSleep();
    const check = new DatabaseHealthCheck(ping, logger, {}, sleep);

    // When
    await check.ensureHealthy();

    // Then
    expect(logger.warn.mock.calls[0][1]).toMatchObject({
      event: 'startup_db_unhealthy',
      attempt: 1,
      totalAttempts: 6,
      maxRetries: 5,
      nextRetryDelayMs: 1_000,
    });
  });

  it('ping が pingTimeoutMs を超えてブロックしたら失敗扱いでリトライする', async () => {
    // Given: 1 回目は解決しない（無限ブロックを模擬）、2 回目以降は即成功
    vi.useFakeTimers();
    try {
      let calls = 0;
      const ping = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            calls += 1;
            if (calls >= 2) resolve();
            // 1 回目は永遠に解決しない
          }),
      );
      const logger = fakeLogger();
      const { sleep, delays } = fakeSleep();
      const check = new DatabaseHealthCheck(ping, logger, { pingTimeoutMs: 100 }, sleep);

      // When: 健康度チェックを開始し、timeout 分だけ時計を進める
      const promise = check.ensureHealthy();
      await vi.advanceTimersByTimeAsync(100); // 1 回目 ping が timeout
      await promise;

      // Then: timeout を失敗とみなして 2 回 ping、1 回 backoff 待機・警告
      expect(ping).toHaveBeenCalledTimes(2);
      expect(delays).toEqual([1_000]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][1]).toMatchObject({ event: 'startup_db_unhealthy' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('DEFAULT_BACKOFF は Issue #187 確定値である', () => {
    // 確定値: 初期 1s / 倍率 2 / 最大 30s / 最大 5 リトライ / ping 上限 5s
    expect(DEFAULT_BACKOFF).toEqual({
      initialDelayMs: 1_000,
      multiplier: 2,
      maxDelayMs: 30_000,
      maxRetries: 5,
      pingTimeoutMs: 5_000,
    });
  });
});
