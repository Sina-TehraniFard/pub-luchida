import { CandleEvent, CandleUpdatedEvent, CandleConfirmedEvent } from './CandleEvent.js';

describe('CandleEvent', () => {
  describe('updated()', () => {
    it('type が UPDATED のイベントを返す', () => {
      // Given: 前提条件なし（ステートレスなファクトリ）

      // When
      const event: CandleUpdatedEvent = CandleEvent.updated();

      // Then
      expect(event.type).toBe('UPDATED');
    });

    it('呼び出すたびに独立したオブジェクトを返す', () => {
      // Given: 前提条件なし（ステートレスなファクトリ）

      // When
      const event1: CandleUpdatedEvent = CandleEvent.updated();
      const event2: CandleUpdatedEvent = CandleEvent.updated();

      // Then: 値は同じだが参照は異なる独立したオブジェクト
      expect(event1.type).toBe('UPDATED');
      expect(event2.type).toBe('UPDATED');
      expect(event1).not.toBe(event2);
    });

    it('type プロパティはランタイムで変更可能だが TypeScript readonly により変更は禁止される', () => {
      // Given: 前提条件なし（ステートレスなファクトリ）

      // When
      const event: CandleUpdatedEvent = CandleEvent.updated();

      // Then: readonly はコンパイル時のみ保護。ランタイムでは Object.freeze されていない
      // （TypeScript の readonly と Object.freeze は別物であることを明示）
      expect(Object.isFrozen(event)).toBe(false);
    });
  });

  describe('confirmed()', () => {
    it('type が CONFIRMED のイベントを返す', () => {
      // Given: 前提条件なし（ステートレスなファクトリ）

      // When
      const event: CandleConfirmedEvent = CandleEvent.confirmed();

      // Then
      expect(event.type).toBe('CONFIRMED');
    });

    it('呼び出すたびに独立したオブジェクトを返す', () => {
      // Given: 前提条件なし（ステートレスなファクトリ）

      // When
      const event1: CandleConfirmedEvent = CandleEvent.confirmed();
      const event2: CandleConfirmedEvent = CandleEvent.confirmed();

      // Then: 値は同じだが参照は異なる独立したオブジェクト
      expect(event1.type).toBe('CONFIRMED');
      expect(event2.type).toBe('CONFIRMED');
      expect(event1).not.toBe(event2);
    });
  });

  describe('型ガード', () => {
    it('event.type === UPDATED で CandleUpdatedEvent に絞り込める', () => {
      // Given
      const events: CandleEvent[] = [
        CandleEvent.updated(),
        CandleEvent.confirmed(),
      ];

      // When
      const updatedEvents: CandleUpdatedEvent[] = [];
      const confirmedEvents: CandleConfirmedEvent[] = [];

      for (const event of events) {
        if (event.type === 'UPDATED') {
          updatedEvents.push(event);
        } else if (event.type === 'CONFIRMED') {
          confirmedEvents.push(event);
        } else {
          // union type の網羅性チェック。将来3つ目の型が追加されると
          // TypeScript がコンパイルエラーを発生させる exhaustive check
          const _exhaustiveCheck: never = event;
          throw new Error(`未知のイベント型: ${JSON.stringify(_exhaustiveCheck)}`);
        }
      }

      // Then
      expect(updatedEvents).toHaveLength(1);
      expect(updatedEvents[0].type).toBe('UPDATED');
      expect(confirmedEvents).toHaveLength(1);
      expect(confirmedEvents[0].type).toBe('CONFIRMED');
    });
  });
});
