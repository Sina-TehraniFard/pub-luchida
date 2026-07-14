import { describe, it, expect } from 'vitest';
import { ExitDispatchResult } from './ExitDispatchResult.js';
import { PositionId } from '../position/PositionId.js';
import { StrategyName } from '../rule/StrategyName.js';

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

describe('ExitDispatchResult', () => {
  describe('of()', () => {
    it('closed/skipped/failed の集計が正しく入る', () => {
      // Given: 決済成功 1 件と失敗 1 件
      const closedId = PositionId.from(UUID_A);
      const failedId = PositionId.from(UUID_B);

      // When: of() で集計結果を構築する
      const result = ExitDispatchResult.of({
        closed: [closedId],
        skipped: [],
        failed: [{ positionId: failedId, strategy: StrategyName.SMA_CROSS, errorName: 'Error' }],
      });

      // Then: 各フィールドに正しく格納される
      expect(result.closed).toEqual([closedId]);
      expect(result.skipped).toEqual([]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.errorName).toBe('Error');
      expect(result.failed[0]?.strategy).toBe(StrategyName.SMA_CROSS);
    });

    it('入力配列を破壊的に参照しない（shallow copy で内部隔離）', () => {
      // Given: closed の入力配列
      const closedArr: PositionId[] = [PositionId.from(UUID_A)];

      // When: of に渡したあとに closedArr を mutate
      const result = ExitDispatchResult.of({ closed: closedArr, skipped: [], failed: [] });
      closedArr.push(PositionId.from(UUID_B));

      // Then: result.closed は影響を受けない
      expect(result.closed).toHaveLength(1);
    });
  });

  describe('empty()', () => {
    it('全フィールド空のインスタンスを返す', () => {
      // Given: 特に前提なし

      // When: empty() で生成する
      const empty = ExitDispatchResult.empty();

      // Then: 各フィールドが空
      expect(empty.closed).toEqual([]);
      expect(empty.skipped).toEqual([]);
      expect(empty.failed).toEqual([]);
    });
  });

  describe('skipped.reason', () => {
    it("reason: 'rule_missing' の skipped エントリを格納できる", () => {
      // Given: 戦略未登録による skipped 1 件
      const positionId = PositionId.from(UUID_A);

      // When: of() で構築する
      const result = ExitDispatchResult.of({
        closed: [],
        skipped: [
          { positionId, strategy: StrategyName.SMA_CROSS, reason: 'rule_missing' },
        ],
        failed: [],
      });

      // Then: reason が正しく格納される
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.reason).toBe('rule_missing');
    });

    it("reason: 'extremes_unavailable' の skipped エントリを格納できる", () => {
      // Given: 極値未追跡による skipped 1 件
      const positionId = PositionId.from(UUID_B);

      // When: of() で構築する
      const result = ExitDispatchResult.of({
        closed: [],
        skipped: [
          { positionId, strategy: StrategyName.SMA_CROSS, reason: 'extremes_unavailable' },
        ],
        failed: [],
      });

      // Then: reason が正しく格納される
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.reason).toBe('extremes_unavailable');
    });
  });

  describe('hasFailure()', () => {
    it('failed が空でない場合 true を返す', () => {
      // Given: failed 1 件を含む結果
      const result = ExitDispatchResult.of({
        closed: [],
        skipped: [],
        failed: [
          { positionId: PositionId.from(UUID_A), strategy: StrategyName.SMA_CROSS, errorName: 'Error' },
        ],
      });

      // When: hasFailure を呼ぶ
      const has = result.hasFailure();

      // Then: true
      expect(has).toBe(true);
    });

    it('failed が空の場合 false を返す', () => {
      // Given: 空の結果
      const empty = ExitDispatchResult.empty();

      // When: hasFailure を呼ぶ
      const has = empty.hasFailure();

      // Then: false
      expect(has).toBe(false);
    });
  });

  describe('hasPermanentSkip()', () => {
    it("rule_missing が含まれる場合 true", () => {
      // Given: skipped に rule_missing 1 件
      const result = ExitDispatchResult.of({
        closed: [],
        skipped: [
          { positionId: PositionId.from(UUID_A), strategy: StrategyName.SMA_CROSS, reason: 'rule_missing' },
        ],
        failed: [],
      });

      // When / Then
      expect(result.hasPermanentSkip()).toBe(true);
    });

    it("extremes_unavailable のみの場合 false（一時的スキップは含めない）", () => {
      // Given: skipped に extremes_unavailable のみ
      const result = ExitDispatchResult.of({
        closed: [],
        skipped: [
          { positionId: PositionId.from(UUID_A), strategy: StrategyName.SMA_CROSS, reason: 'extremes_unavailable' },
        ],
        failed: [],
      });

      // When / Then
      expect(result.hasPermanentSkip()).toBe(false);
    });

    it("skipped が空の場合 false", () => {
      // Given / When / Then
      expect(ExitDispatchResult.empty().hasPermanentSkip()).toBe(false);
    });
  });
});
