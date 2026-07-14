import { describe, it, expect } from 'vitest';
import { BuySell } from '../market/BuySell.js';
import { CurrencyPair } from '../market/CurrencyPair.js';
import { Price } from '../market/Price.js';
import { Timestamp } from '../market/Timestamp.js';
import { Lot } from './Lot.js';
import { OpenPositions } from './OpenPositions.js';
import { Position } from './Position.js';
import { PositionId } from './PositionId.js';
import { EntryCommand } from '../command/EntryCommand.js';
import { EntryResult } from '../market/EntryResult.js';
import { EntryReason } from '../command/EntryReason.js';
import { ConvictionScore } from '../market/ConvictionScore.js';
import { StrategyName } from '../rule/StrategyName.js';
import { EntrySnapshot } from '../market/snapshot/EntrySnapshot.js';
import { Money } from '../Money.js';

const DUMMY_SNAPSHOT = EntrySnapshot.of({ convictionScore: '0.5', entryHour: 12, entryDayOfWeek: 3 });

const USD_JPY = CurrencyPair('USD_JPY');
const EUR_JPY = CurrencyPair('EUR_JPY');

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

function makePosition(
  id: PositionId,
  pair: CurrencyPair,
  strategyName: StrategyName = StrategyName.SMA_CROSS,
  reason: EntryReason = EntryReason.of('SMAクロス'),
): Position {
  const command = EntryCommand.of({
    pair,
    buySell: BuySell.BUY,
    lot: Lot.of(100),
    reason,
    convictionScore: ConvictionScore.of('0.8'),
    strategyName,
    entrySnapshot: DUMMY_SNAPSHOT,
    requiredMargin: Money.jpy('600'),
  });
  const result = EntryResult.of({
    positionId: id,
    entryPrice: Price.of('150.000'),
    executedAt: Timestamp.of(new Date('2024-01-15T10:00:00Z')),
  });
  return Position.open(command, result);
}

const idA = PositionId.from(UUID_A);
const idB = PositionId.from(UUID_B);

describe('OpenPositions', () => {
  describe('empty()', () => {
    it('空のコレクションが生成される', () => {
      // Given: 特に前提なし

      // When: empty() で生成する
      const positions = OpenPositions.empty();

      // Then: count が 0 で isEmpty が true
      expect(positions.count()).toBe(0);
      expect(positions.isEmpty()).toBe(true);
    });
  });

  describe('of()', () => {
    it('既存のポジション配列からコレクションが生成される', () => {
      // Given: 2つのポジション
      const posA = makePosition(idA, USD_JPY);
      const posB = makePosition(idB, EUR_JPY);

      // When: of() で生成する
      const positions = OpenPositions.of([posA, posB]);

      // Then: count が 2 で isEmpty が false
      expect(positions.count()).toBe(2);
      expect(positions.isEmpty()).toBe(false);
    });

    it('空配列を渡すと空のコレクションが生成される', () => {
      // Given: 空配列

      // When: of([]) で生成する
      const positions = OpenPositions.of([]);

      // Then: 空のコレクション
      expect(positions.count()).toBe(0);
      expect(positions.isEmpty()).toBe(true);
    });
  });

  describe('hasPositionFor()', () => {
    it('保有中の通貨ペアを渡すと true が返る', () => {
      // Given: USD_JPY のポジションを持つコレクション
      const positions = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When: USD_JPY で hasPositionFor() を呼ぶ
      const result = positions.hasPositionFor(USD_JPY);

      // Then: true
      expect(result).toBe(true);
    });

    it('保有していない通貨ペアを渡すと false が返る', () => {
      // Given: USD_JPY のポジションを持つコレクション
      const positions = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When: EUR_JPY で hasPositionFor() を呼ぶ（保有なし）
      const result = positions.hasPositionFor(EUR_JPY);

      // Then: false
      expect(result).toBe(false);
    });

    it('空のコレクションではどの通貨ペアでも false が返る', () => {
      // Given: 空のコレクション
      const positions = OpenPositions.empty();

      // When: USD_JPY で hasPositionFor() を呼ぶ
      const result = positions.hasPositionFor(USD_JPY);

      // Then: false
      expect(result).toBe(false);
    });
  });

  describe('getById()', () => {
    it('指定した id のポジションを返す', () => {
      // Given: idA のポジションを持つコレクション
      const posA = makePosition(idA, USD_JPY);
      const positions = OpenPositions.of([posA]);

      // When: idA で getById() を呼ぶ
      const result = positions.getById(idA);

      // Then: 返されたポジションの id が idA と等しい
      expect(result.id.equals(idA)).toBe(true);
    });

    it('存在しない id の場合は Error をスロー', () => {
      // Given: idA のポジションを持つコレクション
      const positions = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When / Then: 存在しない idB で getById() を呼ぶと Error がスローされる
      expect(() => positions.getById(idB)).toThrow(
        '指定した PositionId のポジションが存在しません',
      );
    });
  });

  describe('add()', () => {
    it('ポジションを追加した新しいコレクションが返る', () => {
      // Given: 空のコレクション
      const original = OpenPositions.empty();
      const posA = makePosition(idA, USD_JPY);

      // When: add() でポジションを追加する
      const added = original.add(posA);

      // Then: 新しいコレクションには追加したポジションが含まれる
      expect(added.count()).toBe(1);
      expect(added.getById(idA).id.equals(idA)).toBe(true);
    });

    it('add() は元のインスタンスを変更しない（不変性）', () => {
      // Given: USD_JPY のポジションを持つコレクション
      const original = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When: add() で EUR_JPY のポジションを追加する
      const added = original.add(makePosition(idB, EUR_JPY));

      // Then: 元のコレクションは変わらず count が 1 のまま
      expect(original.count()).toBe(1);
      expect(added.count()).toBe(2);
    });

    it('同じ id のポジションを add しようとすると Error になる', () => {
      // Given: idA のポジションを持つコレクション
      const original = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When / Then: 同じ idA で add() を呼ぶと Error がスローされる
      expect(() => original.add(makePosition(idA, EUR_JPY))).toThrow(
        '同じ PositionId のポジションが既に存在します',
      );
    });
  });

  describe('remove()', () => {
    it('指定した PositionId のポジションを除いた新しいコレクションが返る', () => {
      // Given: idA と idB の2つのポジションを持つコレクション
      const posA = makePosition(idA, USD_JPY);
      const posB = makePosition(idB, EUR_JPY);
      const original = OpenPositions.of([posA, posB]);

      // When: idA を remove() する
      const removed = original.remove(idA);

      // Then: 新しいコレクションには idA がなく idB だけが残る
      expect(removed.count()).toBe(1);
      expect(() => removed.getById(idA)).toThrow();
      expect(removed.getById(idB).id.equals(idB)).toBe(true);
    });

    it('最後の1件を remove すると isEmpty() が true になる', () => {
      // Given: 1つのポジションを持つコレクション
      const original = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When: idA を remove() する
      const removed = original.remove(idA);

      // Then: コレクションが空になる
      expect(removed.count()).toBe(0);
      expect(removed.isEmpty()).toBe(true);
    });

    it('remove() は元のインスタンスを変更しない（不変性）', () => {
      // Given: 2つのポジションを持つコレクション
      const original = OpenPositions.of([
        makePosition(idA, USD_JPY),
        makePosition(idB, EUR_JPY),
      ]);

      // When: idA を remove() する
      const removed = original.remove(idA);

      // Then: 元のコレクションは count が 2 のまま
      expect(original.count()).toBe(2);
      expect(removed.count()).toBe(1);
    });

    it('存在しない id を remove すると Error をスロー', () => {
      // Given: idA のみのコレクション
      const original = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When / Then: 存在しない idB を remove() すると Error がスローされる
      expect(() => original.remove(idB)).toThrow(
        '指定した PositionId のポジションが存在しません',
      );
    });
  });

  describe('count() / isEmpty()', () => {
    it('ポジションを追加するたびに count() が増える', () => {
      // Given: 空のコレクション
      const empty = OpenPositions.empty();

      // When: 1つ、2つと追加していく
      const one = empty.add(makePosition(idA, USD_JPY));
      const two = one.add(makePosition(idB, EUR_JPY));

      // Then: 各ステップで count() が正しい
      expect(empty.count()).toBe(0);
      expect(one.count()).toBe(1);
      expect(two.count()).toBe(2);
    });

    it('isEmpty() はポジションが存在するときに false を返す', () => {
      // Given: 1つのポジションを持つコレクション
      const positions = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When / Then: isEmpty() は false
      expect(positions.isEmpty()).toBe(false);
    });
  });

  describe('heldStrategyNamesFor()', () => {
    it('指定 pair に紐づく保有戦略のみを返す', () => {
      // Given: USD_JPY に SMA_CROSS、EUR_JPY に RSI_REVERSAL を保有
      const positions = OpenPositions.of([
        makePosition(idA, USD_JPY, StrategyName.SMA_CROSS),
        makePosition(idB, EUR_JPY, StrategyName.RSI_REVERSAL),
      ]);

      // When: USD_JPY で問い合わせ
      const held = positions.heldStrategyNamesFor(USD_JPY);

      // Then: SMA_CROSS のみ含まれ、EUR_JPY 側の RSI_REVERSAL は含まれない
      expect(held.has('SMA_CROSS')).toBe(true);
      expect(held.has('RSI_REVERSAL')).toBe(false);
      expect(held.size).toBe(1);
    });

    it('同一 pair に複数戦略を保有している場合はすべて返す', () => {
      // Given: USD_JPY に SMA_CROSS と RSI_REVERSAL を併せ持つ
      const positions = OpenPositions.of([
        makePosition(idA, USD_JPY, StrategyName.SMA_CROSS),
        makePosition(idB, USD_JPY, StrategyName.RSI_REVERSAL),
      ]);

      // When
      const held = positions.heldStrategyNamesFor(USD_JPY);

      // Then
      expect(held.has('SMA_CROSS')).toBe(true);
      expect(held.has('RSI_REVERSAL')).toBe(true);
      expect(held.size).toBe(2);
    });

    it('該当 pair のポジションがなければ空集合を返す', () => {
      // Given: USD_JPY のみ保有
      const positions = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When: EUR_JPY で問い合わせ
      const held = positions.heldStrategyNamesFor(EUR_JPY);

      // Then: 空集合
      expect(held.size).toBe(0);
    });

    it('空コレクションでも空集合を返す（throw しない）', () => {
      // Given / When
      const held = OpenPositions.empty().heldStrategyNamesFor(USD_JPY);

      // Then
      expect(held.size).toBe(0);
    });
  });

  describe('holdsStrategyOnPair()', () => {
    it('指定 pair × 指定 strategy を保有していれば true', () => {
      // Given
      const positions = OpenPositions.of([
        makePosition(idA, USD_JPY, StrategyName.SMA_CROSS),
      ]);

      // When / Then
      expect(positions.holdsStrategyOnPair(USD_JPY, StrategyName.SMA_CROSS)).toBe(true);
    });

    it('pair が一致しても strategy が異なれば false', () => {
      // Given
      const positions = OpenPositions.of([
        makePosition(idA, USD_JPY, StrategyName.SMA_CROSS),
      ]);

      // When / Then
      expect(positions.holdsStrategyOnPair(USD_JPY, StrategyName.RSI_REVERSAL)).toBe(false);
    });

    it('strategy が一致しても pair が異なれば false', () => {
      // Given
      const positions = OpenPositions.of([
        makePosition(idA, USD_JPY, StrategyName.SMA_CROSS),
      ]);

      // When / Then
      expect(positions.holdsStrategyOnPair(EUR_JPY, StrategyName.SMA_CROSS)).toBe(false);
    });

    it('空コレクションでは常に false', () => {
      // Given / When / Then
      expect(OpenPositions.empty().holdsStrategyOnPair(USD_JPY, StrategyName.SMA_CROSS)).toBe(false);
    });

    it('StrategyName を別経路で生成して渡しても strategyNameEquals 経由で判定される', () => {
      // Given: 定数ではなく factory 経由で生成（branded string ゆえ値が同じなら === 同一）
      const dynamicSma = StrategyName('SMA_CROSS');
      const positions = OpenPositions.of([
        makePosition(idA, USD_JPY, dynamicSma),
      ]);

      // When / Then: 別経路生成でも定数で問い合わせて true
      expect(positions.holdsStrategyOnPair(USD_JPY, StrategyName.SMA_CROSS)).toBe(true);
    });
  });

  describe('of() 重複拒否', () => {
    it('同一 PositionId のポジションを含む配列を渡すと throw する', () => {
      // Given: 同じ id を 2 つ含む配列
      const positions = [
        makePosition(idA, USD_JPY),
        makePosition(idA, EUR_JPY), // pair が違っても id が同じならNG
      ];

      // When / Then
      expect(() => OpenPositions.of(positions)).toThrow(/同じ PositionId/);
    });
  });

  describe('equals()', () => {
    it('同じ id 集合なら順序が違っても等価', () => {
      // Given
      const a = OpenPositions.of([
        makePosition(idA, USD_JPY),
        makePosition(idB, EUR_JPY),
      ]);
      const b = OpenPositions.of([
        makePosition(idB, EUR_JPY),
        makePosition(idA, USD_JPY),
      ]);

      // When / Then
      expect(a.equals(b)).toBe(true);
    });

    it('要素数が違うと非等価', () => {
      // Given
      const a = OpenPositions.of([makePosition(idA, USD_JPY)]);
      const b = OpenPositions.of([
        makePosition(idA, USD_JPY),
        makePosition(idB, EUR_JPY),
      ]);

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('要素数が同じでも id 集合が異なれば非等価', () => {
      // Given
      const a = OpenPositions.of([makePosition(idA, USD_JPY)]);
      const b = OpenPositions.of([makePosition(idB, USD_JPY)]);

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('空コレクション同士は等価', () => {
      // Given / When / Then
      expect(OpenPositions.empty().equals(OpenPositions.empty())).toBe(true);
    });
  });

  describe('forPair(pair)', () => {
    it('指定 pair のポジションのみを含む新しい OpenPositions を返す', () => {
      // Given: USD_JPY と EUR_JPY のポジションを含むコレクション
      const usdJpy = makePosition(idA, USD_JPY);
      const eurJpy = makePosition(idB, EUR_JPY);
      const all = OpenPositions.of([usdJpy, eurJpy]);

      // When: USD_JPY で射影する
      const usdOnly = all.forPair(USD_JPY);

      // Then: USD_JPY のみ含まれる
      expect(usdOnly.count()).toBe(1);
      expect(usdOnly.hasPositionFor(USD_JPY)).toBe(true);
      expect(usdOnly.hasPositionFor(EUR_JPY)).toBe(false);
    });

    it('該当なしの場合は空 OpenPositions を返す', () => {
      // Given: USD_JPY のポジションのみ
      const all = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When: EUR_JPY で射影する
      const filtered = all.forPair(EUR_JPY);

      // Then: 空
      expect(filtered.isEmpty()).toBe(true);
    });

    it('元の OpenPositions を破壊しない（不変）', () => {
      // Given: USD_JPY のポジション
      const all = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When: forPair で射影する
      all.forPair(EUR_JPY);

      // Then: 元のコレクションは変わらない
      expect(all.count()).toBe(1);
    });
  });

  describe('missingFrom(ids)', () => {
    it('指定した id 群に含まれないポジションのみを返す', () => {
      // Given: A と B を保有、ブローカー側には A のみ存在
      const all = OpenPositions.of([
        makePosition(idA, USD_JPY),
        makePosition(idB, USD_JPY),
      ]);

      // When
      const missing = all.missingFrom([idA]);

      // Then: B のみが「ブローカーに不在」
      expect(missing.count()).toBe(1);
      expect(missing.getById(idB).id.equals(idB)).toBe(true);
    });

    it('全 id が含まれていれば空 OpenPositions を返す', () => {
      // Given
      const all = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When / Then
      expect(all.missingFrom([idA, idB]).isEmpty()).toBe(true);
    });

    it('空の id 群なら全ポジションを返す', () => {
      // Given
      const all = OpenPositions.of([
        makePosition(idA, USD_JPY),
        makePosition(idB, EUR_JPY),
      ]);

      // When / Then
      expect(all.missingFrom([]).count()).toBe(2);
    });

    it('元の OpenPositions を破壊しない（不変）', () => {
      // Given
      const all = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When
      all.missingFrom([idA]);

      // Then
      expect(all.count()).toBe(1);
    });
  });

  describe('heldStrategyNames()', () => {
    it('全 pair の保有戦略名集合を返す（重複除去）', () => {
      // Given: 異なる pair × 重複戦略を含むポジション群
      const a = makePosition(idA, USD_JPY, StrategyName.SMA_CROSS);
      const b = makePosition(idB, EUR_JPY, StrategyName.SMA_CROSS);
      const all = OpenPositions.of([a, b]);

      // When: heldStrategyNames で集合を取得
      const names = all.heldStrategyNames();

      // Then: 重複は除かれて 1 件
      expect(names.size).toBe(1);
      expect(names.has('SMA_CROSS')).toBe(true);
    });

    it('空コレクションでは空集合を返す', () => {
      // Given / When
      const names = OpenPositions.empty().heldStrategyNames();

      // Then
      expect(names.size).toBe(0);
    });
  });

  describe('sortedByOpenedAtAsc()', () => {
    function makeWithOpenedAt(id: PositionId, isoTimestamp: string): Position {
      const command = EntryCommand.of({
        pair: USD_JPY,
        buySell: BuySell.BUY,
        lot: Lot.of(100),
        reason: EntryReason.of('test'),
        convictionScore: ConvictionScore.of('0.8'),
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: DUMMY_SNAPSHOT,
        requiredMargin: Money.jpy('600'),
      });
      const result = EntryResult.of({
        positionId: id,
        entryPrice: Price.of('150.000'),
        executedAt: Timestamp.of(new Date(isoTimestamp)),
      });
      return Position.open(command, result);
    }

    it('openedAt 昇順で並べる', () => {
      // Given: 新しい順に並んだポジション 2 つ
      const newer = makeWithOpenedAt(idA, '2026-01-15T11:00:00Z');
      const older = makeWithOpenedAt(idB, '2026-01-15T10:00:00Z');
      const all = OpenPositions.of([newer, older]);

      // When: sortedByOpenedAtAsc で並べる
      const sorted = all.sortedByOpenedAtAsc();
      const ids = [...sorted].map((p) => p.id.toString());

      // Then: 古い順に並ぶ
      expect(ids).toEqual([UUID_B, UUID_A]);
    });

    it('同 openedAt のときは PositionId.compareTo で二次キー順に並べる', () => {
      // Given: 同時刻でidA < idB の 2 つ（UUID_A < UUID_B の辞書順）
      const sameTime = '2026-01-15T10:00:00Z';
      const posA = makeWithOpenedAt(idA, sameTime);
      const posB = makeWithOpenedAt(idB, sameTime);
      // 逆順で投入
      const all = OpenPositions.of([posB, posA]);

      // When: sortedByOpenedAtAsc で並べる
      const sorted = all.sortedByOpenedAtAsc();
      const ids = [...sorted].map((p) => p.id.toString());

      // Then: PositionId.compareTo 順（A → B）に並ぶ
      expect(ids).toEqual([UUID_A, UUID_B]);
    });

    it('戻り値は OpenPositions（自己同型）', () => {
      // Given
      const all = OpenPositions.of([makePosition(idA, USD_JPY)]);

      // When
      const sorted = all.sortedByOpenedAtAsc();

      // Then
      expect(sorted).toBeInstanceOf(OpenPositions);
    });

    it('元の OpenPositions を破壊しない', () => {
      // Given
      const older = makeWithOpenedAt(idA, '2026-01-15T10:00:00Z');
      const newer = makeWithOpenedAt(idB, '2026-01-15T11:00:00Z');
      const all = OpenPositions.of([newer, older]);
      const originalIds = [...all].map((p) => p.id.toString());

      // When
      all.sortedByOpenedAtAsc();

      // Then: 元の順序維持
      expect([...all].map((p) => p.id.toString())).toEqual(originalIds);
    });

    it('空 OpenPositions では空 OpenPositions を返す', () => {
      // Given / When / Then
      expect(OpenPositions.empty().sortedByOpenedAtAsc().isEmpty()).toBe(true);
    });
  });
});
