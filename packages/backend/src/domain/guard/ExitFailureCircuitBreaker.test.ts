import { describe, it, expect, beforeEach } from 'vitest';
import { ExitFailureCircuitBreaker } from './ExitFailureCircuitBreaker.js';
import { ExitFailureThreshold } from './ExitFailureThreshold.js';
import { PositionId } from '../position/PositionId.js';

const ID_A = PositionId.from('550e8400-e29b-41d4-a716-446655440000');
const ID_B = PositionId.from('6ba7b810-9dad-41d1-80b4-00c04fd430c8');

describe('ExitFailureCircuitBreaker', () => {
  let breaker: ExitFailureCircuitBreaker;

  beforeEach(() => {
    // 閾値 3・クールダウン 2 tick（テスト用に小さく）
    breaker = new ExitFailureCircuitBreaker(ExitFailureThreshold.of(3), 2);
  });

  describe('生成', () => {
    it('cooldownTicks が負数・小数ならエラー', () => {
      expect(() => new ExitFailureCircuitBreaker(ExitFailureThreshold.of(3), -1)).toThrow(
        '0 以上の整数',
      );
      expect(() => new ExitFailureCircuitBreaker(ExitFailureThreshold.of(3), 1.5)).toThrow(
        '0 以上の整数',
      );
    });

    it('cooldownTicks 0 は許容（クールダウンなし＝毎 tick 再試行）', () => {
      const noCooldown = new ExitFailureCircuitBreaker(ExitFailureThreshold.of(3), 0);
      noCooldown.beginTick([ID_A]);
      noCooldown.recordFailure(ID_A);
      noCooldown.beginTick([ID_A]);
      expect(noCooldown.admitAttempt(ID_A)).toBe(true);
    });
  });

  describe('admitAttempt（クールダウン）', () => {
    it('初見のポジションは常に許可', () => {
      breaker.beginTick([ID_A]);
      expect(breaker.admitAttempt(ID_A)).toBe(true);
    });

    it('失敗直後はクールダウンで拒否、cooldownTicks 経過後に再許可', () => {
      breaker.beginTick([ID_A]); // tick=1
      breaker.recordFailure(ID_A); // cooldownUntil = 3
      breaker.beginTick([ID_A]); // tick=2
      expect(breaker.admitAttempt(ID_A)).toBe(false);
      breaker.beginTick([ID_A]); // tick=3
      expect(breaker.admitAttempt(ID_A)).toBe(true);
    });

    it('クールダウンはポジション別（A の失敗は B に波及しない）', () => {
      breaker.beginTick([ID_A, ID_B]);
      breaker.recordFailure(ID_A);
      breaker.beginTick([ID_A, ID_B]);
      expect(breaker.admitAttempt(ID_A)).toBe(false);
      expect(breaker.admitAttempt(ID_B)).toBe(true);
    });
  });

  describe('連続失敗カウントと kill 判定', () => {
    it('recordFailure は更新後の連続失敗回数を返す', () => {
      breaker.beginTick([ID_A]);
      expect(breaker.recordFailure(ID_A)).toBe(1);
      expect(breaker.recordFailure(ID_A)).toBe(2);
    });

    it('閾値未満では shouldKill しない', () => {
      breaker.beginTick([ID_A]);
      breaker.recordFailure(ID_A);
      breaker.recordFailure(ID_A);
      expect(breaker.shouldKill()).toBe(false);
      expect(breaker.killDetail()).toBeNull();
    });

    it('連続 3 回で shouldKill、killDetail に根拠が載る', () => {
      breaker.beginTick([ID_A]);
      breaker.recordFailure(ID_A);
      breaker.recordFailure(ID_A);
      breaker.recordFailure(ID_A);
      expect(breaker.shouldKill()).toBe(true);
      expect(breaker.killDetail()).toEqual({
        positionId: ID_A.toString(),
        consecutiveFailures: 3,
        threshold: 3,
      });
    });

    it('成功でカウントはリセットされる', () => {
      breaker.beginTick([ID_A]);
      breaker.recordFailure(ID_A);
      breaker.recordFailure(ID_A);
      breaker.recordSuccess(ID_A);
      expect(breaker.recordFailure(ID_A)).toBe(1);
      expect(breaker.shouldKill()).toBe(false);
    });

    it('間欠失敗（発火しない tick を挟む）でもカウントは維持される', () => {
      breaker.beginTick([ID_A]);
      breaker.recordFailure(ID_A);
      breaker.recordFailure(ID_A);
      // ExitRule が発火しない tick が続く（recordFailure も recordSuccess も呼ばれない）
      breaker.beginTick([ID_A]);
      breaker.beginTick([ID_A]);
      expect(breaker.recordFailure(ID_A)).toBe(3);
      expect(breaker.shouldKill()).toBe(true);
    });

    it('複数ポジションが閾値到達時は最多失敗を killDetail に載せる', () => {
      breaker.beginTick([ID_A, ID_B]);
      for (let i = 0; i < 3; i++) breaker.recordFailure(ID_A);
      for (let i = 0; i < 5; i++) breaker.recordFailure(ID_B);
      expect(breaker.killDetail()?.positionId).toBe(ID_B.toString());
      expect(breaker.killDetail()?.consecutiveFailures).toBe(5);
    });
  });

  describe('beginTick（OPEN 集合による掃除）', () => {
    it('OPEN 集合から消えたポジションの記録は削除される（定期 sync による CLOSED 化）', () => {
      breaker.beginTick([ID_A]);
      breaker.recordFailure(ID_A);
      breaker.recordFailure(ID_A);
      breaker.recordFailure(ID_A);
      expect(breaker.shouldKill()).toBe(true);
      // sync が DB を CLOSED に直した → OPEN 集合から消える
      breaker.beginTick([]);
      expect(breaker.shouldKill()).toBe(false);
      expect(breaker.admitAttempt(ID_A)).toBe(true);
    });

    it('OPEN 集合に残っている間は記録が維持される', () => {
      breaker.beginTick([ID_A]);
      breaker.recordFailure(ID_A);
      breaker.beginTick([ID_A]);
      expect(breaker.admitAttempt(ID_A)).toBe(false);
    });
  });
});
