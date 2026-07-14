import { describe, it, expect } from 'vitest';
import Big from 'big.js';
import { EqualWeightAllocationPolicy } from './EqualWeightAllocationPolicy.js';
import { AllocationContext } from './AllocationContext.js';
import { DetectedSignals } from '../rule/DetectedSignals.js';
import { OpenPositions } from '../position/OpenPositions.js';
import { Balance } from '../Balance.js';
import { Money } from '../Money.js';
import { StrategyName } from '../rule/StrategyName.js';
import { Ratio } from '../Ratio.js';
import { Position } from '../position/Position.js';
import { PositionId } from '../position/PositionId.js';
import { EntryCommand } from '../command/EntryCommand.js';
import { EntryResult } from '../market/EntryResult.js';
import { EntryReason } from '../command/EntryReason.js';
import { CurrencyPair } from '../market/CurrencyPair.js';
import { BuySell } from '../market/BuySell.js';
import { Lot } from '../position/Lot.js';
import { Price } from '../market/Price.js';
import { Timestamp } from '../market/Timestamp.js';
import { ConvictionScore } from '../market/ConvictionScore.js';
import { EntrySnapshot } from '../market/snapshot/EntrySnapshot.js';

const DUMMY_SNAPSHOT = EntrySnapshot.of({
  convictionScore: '0.5',
  entryHour: 12,
  entryDayOfWeek: 3,
});

const BALANCE = Balance.of(Money.jpy('1000000'));
const PAIR_USD = CurrencyPair('USD_JPY');
const PAIR_EUR = CurrencyPair('EUR_JPY');

const makePosition = (
  strategy: StrategyName,
  pair: CurrencyPair = PAIR_USD,
  openedAt = '2024-01-15T10:00:00.000Z',
): Position => {
  const command = EntryCommand.of({
    pair,
    buySell: BuySell.BUY,
    lot: Lot.of(100),
    reason: EntryReason.of('test'),
    convictionScore: ConvictionScore.of('0.8'),
    strategyName: strategy,
    entrySnapshot: DUMMY_SNAPSHOT,
    requiredMargin: Money.jpy('600'),
  });
  const result = EntryResult.of({
    positionId: PositionId.generate(),
    entryPrice: Price.of('150.500'),
    executedAt: Timestamp.of(new Date(openedAt)),
  });
  return Position.open(command, result);
};

const makeContext = (
  detected: StrategyName[],
  held: { strategy: StrategyName; pair?: CurrencyPair }[] = [],
  pair: CurrencyPair = PAIR_USD,
): AllocationContext => {
  const ds = DetectedSignals.of(detected);
  // h.pair が省略された場合は判定対象 pair（外側の関数引数）に揃える。
  // PAIR_USD ハードコードを使うと、判定対象 pair を切り替えたテストで held が無効化されてしまう。
  const op = OpenPositions.of(held.map((h) => makePosition(h.strategy, h.pair ?? pair)));
  return AllocationContext.of(pair, ds, op, BALANCE);
};

describe('EqualWeightAllocationPolicy', () => {
  const policy = new EqualWeightAllocationPolicy();

  describe('decide() - 検知ゼロ', () => {
    it('detected が空なら全抑制を返す', () => {
      // Given
      const ctx = makeContext([]);

      // When
      const allocation = policy.decide(ctx);

      // Then
      expect(allocation.isFullySuppressed()).toBe(true);
    });
  });

  describe('decide() - 保有抑制', () => {
    it('detected の全戦略が同 pair で既に保有中なら全抑制を返す', () => {
      // Given
      const ctx = makeContext(
        [StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL],
        [
          { strategy: StrategyName.SMA_CROSS },
          { strategy: StrategyName.RSI_REVERSAL },
        ],
      );

      // When
      const allocation = policy.decide(ctx);

      // Then
      expect(allocation.isFullySuppressed()).toBe(true);
      expect(allocation.isSuppressed(StrategyName.SMA_CROSS)).toBe(true);
      expect(allocation.isSuppressed(StrategyName.RSI_REVERSAL)).toBe(true);
    });

    it('detected の一部が同 pair で保有中なら、その戦略のみ抑制し残りに等ウェイト配分', () => {
      // Given
      const ctx = makeContext(
        [StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL, StrategyName.WICK_REVERSAL],
        [{ strategy: StrategyName.RSI_REVERSAL }],
      );

      // When
      const allocation = policy.decide(ctx);

      // Then
      expect(allocation.isSuppressed(StrategyName.RSI_REVERSAL)).toBe(true);
      // 2 戦略 eligible: SMA_CROSS と WICK_REVERSAL に 0.5 / 0.5
      expect(allocation.ratioOf(StrategyName.SMA_CROSS).equals(Ratio.of('0.5'))).toBe(true);
      expect(allocation.ratioOf(StrategyName.WICK_REVERSAL).equals(Ratio.of('0.5'))).toBe(true);
    });

    it('異 pair で同戦略を保有していても、対象 pair の配分には影響しない（multi-pair 対応）', () => {
      // Given: EUR_JPY で SMA_CROSS を保有、USD_JPY 配分判定
      const ctx = makeContext(
        [StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL],
        [{ strategy: StrategyName.SMA_CROSS, pair: PAIR_EUR }],
        PAIR_USD,
      );

      // When
      const allocation = policy.decide(ctx);

      // Then: USD_JPY 側の SMA_CROSS は抑制されない
      expect(allocation.isSuppressed(StrategyName.SMA_CROSS)).toBe(false);
      expect(allocation.ratioOf(StrategyName.SMA_CROSS).equals(Ratio.of('0.5'))).toBe(true);
      expect(allocation.ratioOf(StrategyName.RSI_REVERSAL).equals(Ratio.of('0.5'))).toBe(true);
    });
  });

  describe('decide() - 等ウェイト配分（残余寄せ）', () => {
    it('n=1: 単一戦略に Ratio.one() を割り当て', () => {
      // Given
      const ctx = makeContext([StrategyName.SMA_CROSS]);

      // When
      const allocation = policy.decide(ctx);

      // Then
      expect(allocation.ratioOf(StrategyName.SMA_CROSS).equals(Ratio.one())).toBe(true);
    });

    it('n=2: 0.5 / 0.5 ぴったり', () => {
      // Given
      const ctx = makeContext([StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL]);

      // When
      const allocation = policy.decide(ctx);

      // Then
      expect(allocation.ratioOf(StrategyName.SMA_CROSS).equals(Ratio.of('0.5'))).toBe(true);
      expect(allocation.ratioOf(StrategyName.RSI_REVERSAL).equals(Ratio.of('0.5'))).toBe(true);
    });

    it('n=3: 先頭 2 個に 0.3333333333、末尾に 0.3333333334（残余寄せ、合計=1.0）', () => {
      // Given
      const ctx = makeContext([
        StrategyName.SMA_CROSS,
        StrategyName.RSI_REVERSAL,
        StrategyName.WICK_REVERSAL,
      ]);

      // When
      const allocation = policy.decide(ctx);

      // Then
      expect(
        allocation.ratioOf(StrategyName.SMA_CROSS).equals(Ratio.of('0.3333333333')),
      ).toBe(true);
      expect(
        allocation.ratioOf(StrategyName.RSI_REVERSAL).equals(Ratio.of('0.3333333333')),
      ).toBe(true);
      expect(
        allocation.ratioOf(StrategyName.WICK_REVERSAL).equals(Ratio.of('0.3333333334')),
      ).toBe(true);
    });

    it('n=4: すべて 0.25 ぴったり', () => {
      // Given
      const ctx = makeContext([
        StrategyName.SMA_CROSS,
        StrategyName.RSI_REVERSAL,
        StrategyName.SMA_DISTANCE,
        StrategyName.WICK_REVERSAL,
      ]);

      // When
      const allocation = policy.decide(ctx);

      // Then
      const expected = Ratio.of('0.25');
      expect(allocation.ratioOf(StrategyName.SMA_CROSS).equals(expected)).toBe(true);
      expect(allocation.ratioOf(StrategyName.RSI_REVERSAL).equals(expected)).toBe(true);
      expect(allocation.ratioOf(StrategyName.SMA_DISTANCE).equals(expected)).toBe(true);
      expect(allocation.ratioOf(StrategyName.WICK_REVERSAL).equals(expected)).toBe(true);
    });

    it('保有戦略を間に挟んでも、eligible への等ウェイト割り当ての順序は detected 順を保つ', () => {
      // Given: detected 順 [WICK, SMA(保有), RSI]、SMA は同 pair で保有中
      const ctx = makeContext(
        [StrategyName.WICK_REVERSAL, StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL],
        [{ strategy: StrategyName.SMA_CROSS }],
      );

      // When
      const allocation = policy.decide(ctx);

      // Then: detected 順で eligible は WICK → RSI、両方 0.5。SMA は抑制
      expect(allocation.ratioOf(StrategyName.WICK_REVERSAL).equals(Ratio.of('0.5'))).toBe(true);
      expect(allocation.ratioOf(StrategyName.RSI_REVERSAL).equals(Ratio.of('0.5'))).toBe(true);
      expect(allocation.isSuppressed(StrategyName.SMA_CROSS)).toBe(true);
    });
  });

  describe('decide() - 合計検証', () => {
    it('n=3 の比率を big.js で合算しても 1.0', () => {
      // Given
      const ctx = makeContext([
        StrategyName.SMA_CROSS,
        StrategyName.RSI_REVERSAL,
        StrategyName.WICK_REVERSAL,
      ]);

      // When
      const allocation = policy.decide(ctx);
      const sum = [
        StrategyName.SMA_CROSS,
        StrategyName.RSI_REVERSAL,
        StrategyName.WICK_REVERSAL,
      ]
        .map((s) => allocation.ratioOf(s).toBig())
        .reduce((acc, r) => acc.plus(r), new Big(0));

      // Then
      expect(sum.eq(1)).toBe(true);
    });
  });
});
