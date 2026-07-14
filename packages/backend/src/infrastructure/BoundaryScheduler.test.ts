import { describe, it, expect, beforeEach } from 'vitest';
import { Clock } from '../port/Clock.js';
import { TimeFrame } from '../domain/market/TimeFrame.js';
import { BoundaryScheduler, TimerApi } from './BoundaryScheduler.js';

/** 時刻を手動で進められる Fake Clock */
class FakeClock implements Clock {
  constructor(private ms: number) {}
  now(): Date {
    return new Date(this.ms);
  }
  set(ms: number): void {
    this.ms = ms;
  }
}

/** 登録されたタイマーを手動で発火できる Fake TimerApi */
class FakeTimer implements TimerApi {
  private seq = 0;
  readonly scheduled = new Map<number, { cb: () => void; delay: number }>();

  set(callback: () => void, delayMs: number): unknown {
    const id = ++this.seq;
    this.scheduled.set(id, { cb: callback, delay: delayMs });
    return id;
  }
  clear(handle: unknown): void {
    this.scheduled.delete(handle as number);
  }
  /** 最後に登録されたタイマーを発火する */
  fireLatest(): void {
    const ids = [...this.scheduled.keys()];
    const last = ids[ids.length - 1];
    const entry = this.scheduled.get(last)!;
    this.scheduled.delete(last);
    entry.cb();
  }
  get count(): number {
    return this.scheduled.size;
  }
}

describe('BoundaryScheduler', () => {
  let clock: FakeClock;
  let timer: FakeTimer;
  let fired: TimeFrame[];

  beforeEach(() => {
    // 10:07:00 UTC（15分足の次境界は 10:15:00）
    clock = new FakeClock(new Date('2024-01-15T10:07:00.000Z').getTime());
    timer = new FakeTimer();
    fired = [];
  });

  const scheduler = (offsetMs = 15_000) =>
    new BoundaryScheduler(
      clock,
      [TimeFrame.FIFTEEN_MINUTE],
      offsetMs,
      async (tf) => {
        fired.push(tf);
      },
      timer,
    );

  it('start() で次境界+offset の遅延でタイマーを登録する', () => {
    // Given: 10:07:00、次の15分境界は 10:15:00、+15秒 = 10:15:15
    const s = scheduler();

    // When
    s.start();

    // Then: 遅延は 8分15秒 = 495000ms
    const entry = [...timer.scheduled.values()][0];
    expect(entry.delay).toBe(495_000);
  });

  it('発火すると onBoundary が呼ばれ、次の境界へ再スケジュールする', async () => {
    // Given
    const s = scheduler();
    s.start();

    // When: 発火時刻に時計を進めて発火
    clock.set(new Date('2024-01-15T10:15:15.000Z').getTime());
    timer.fireLatest();
    // fire は async。次スケジュールは await 後の finally で行われるため待つ
    await Promise.resolve();
    await Promise.resolve();

    // Then: コールバックが呼ばれ、次のタイマーが登録される
    expect(fired).toEqual([TimeFrame.FIFTEEN_MINUTE]);
    expect(timer.count).toBe(1);
    // 次境界は 10:30:00 + 15秒 = 10:30:15。現在 10:15:15 からちょうど15分 = 900000ms
    const entry = [...timer.scheduled.values()][0];
    expect(entry.delay).toBe(900_000);
  });

  it('start() を多重呼び出ししても重複タイマーを登録しない', () => {
    // Given: 1度 start 済み
    const s = scheduler();
    s.start();
    expect(timer.count).toBe(1);

    // When: 再度 start（再入ガードで弾かれる想定）
    s.start();

    // Then: タイマーは増えず、stop で完全に解除できる
    expect(timer.count).toBe(1);
    s.stop();
    expect(timer.count).toBe(0);
  });

  it('stop() で全タイマーを解除する', () => {
    // Given
    const s = scheduler();
    s.start();
    expect(timer.count).toBe(1);

    // When
    s.stop();

    // Then
    expect(timer.count).toBe(0);
  });

  it('複数足を登録すると足ごとにタイマーが登録される', () => {
    // Given
    const s = new BoundaryScheduler(
      clock,
      [TimeFrame.FIFTEEN_MINUTE, TimeFrame.ONE_HOUR, TimeFrame.ONE_DAY],
      15_000,
      async (tf) => {
        fired.push(tf);
      },
      timer,
    );

    // When
    s.start();

    // Then
    expect(timer.count).toBe(3);
  });
});
