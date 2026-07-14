import { describe, it, expect } from 'vitest';
import { EntryCommand } from './EntryCommand.js';
import { EntryReason } from './EntryReason.js';
import { CurrencyPair } from '../market/CurrencyPair.js';
import { BuySell } from '../market/BuySell.js';
import { Lot } from '../position/Lot.js';
import { ConvictionScore } from '../market/ConvictionScore.js';
import { StrategyName } from '../rule/StrategyName.js';
import { EntrySnapshot } from '../market/snapshot/EntrySnapshot.js';
import { Money } from '../Money.js';

const DUMMY_SNAPSHOT = EntrySnapshot.of({ convictionScore: '0.5', entryHour: 12, entryDayOfWeek: 3 });
const DUMMY_REQUIRED_MARGIN = Money.jpy('0');

describe('EntryCommand', () => {
  describe('生成（正常系）', () => {
    it('BUY 方向でエントリー命令が生成される', () => {
      // Given: BUY 方向の有効なパラメータ
      const pair = CurrencyPair('USD_JPY');
      const buySell = BuySell.BUY;
      const lot = Lot.of(100);
      const reason = EntryReason.of('SMA ゴールデンクロス発生');
      const convictionScore = ConvictionScore.of('0.8');

      // When: EntryCommand.of() で生成する
      const command = EntryCommand.of({
        pair,
        buySell,
        lot,
        reason,
        convictionScore,
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: DUMMY_SNAPSHOT,
        requiredMargin: DUMMY_REQUIRED_MARGIN,
      });

      // Then: 各フィールドが正しく保持される
      expect(command.pair).toBe(pair);
      expect(command.buySell).toBe(BuySell.BUY);
      expect(command.lot.toNumber()).toBe(100);
      expect(command.reason.toString()).toBe('SMA ゴールデンクロス発生');
      expect(command.convictionScore.toString()).toBe('0.8');
    });

    it('SELL 方向でエントリー命令が生成される', () => {
      // Given: SELL 方向の有効なパラメータ
      const pair = CurrencyPair('EUR_JPY');
      const buySell = BuySell.SELL;
      const lot = Lot.of(300);
      const reason = EntryReason.of('SMA デッドクロス発生');
      const convictionScore = ConvictionScore.of('0.6');

      // When: EntryCommand.of() で生成する
      const command = EntryCommand.of({
        pair,
        buySell,
        lot,
        reason,
        convictionScore,
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: DUMMY_SNAPSHOT,
        requiredMargin: DUMMY_REQUIRED_MARGIN,
      });

      // Then: 各フィールドが正しく保持される
      expect(command.pair).toBe(pair);
      expect(command.buySell).toBe(BuySell.SELL);
      expect(command.lot.toNumber()).toBe(300);
      expect(command.reason.toString()).toBe('SMA デッドクロス発生');
      expect(command.convictionScore.toString()).toBe('0.6');
    });
  });

  describe('reason の保持', () => {
    it('reason が EntryReason インスタンスとして保持される', () => {
      // Given
      const reason = EntryReason.of('SMA クロス');

      // When
      const command = EntryCommand.of({
        pair: CurrencyPair('USD_JPY'),
        buySell: BuySell.BUY,
        lot: Lot.of(100),
        reason,
        convictionScore: ConvictionScore.of('0.5'),
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: DUMMY_SNAPSHOT,
        requiredMargin: DUMMY_REQUIRED_MARGIN,
      });

      // Then: reason は EntryReason インスタンスであり toString() で値を取得できる
      expect(command.reason).toBeInstanceOf(EntryReason);
      expect(command.reason.toString()).toBe('SMA クロス');
    });
  });

  describe('convictionScore の保持', () => {
    it('convictionScore が ConvictionScore インスタンスとして保持される', () => {
      // Given
      const convictionScore = ConvictionScore.of('0.75');

      // When
      const command = EntryCommand.of({
        pair: CurrencyPair('USD_JPY'),
        buySell: BuySell.BUY,
        lot: Lot.of(100),
        reason: EntryReason.of('SMA クロス'),
        convictionScore,
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: DUMMY_SNAPSHOT,
        requiredMargin: DUMMY_REQUIRED_MARGIN,
      });

      // Then: convictionScore は ConvictionScore インスタンスであり toString() で値を取得できる
      expect(command.convictionScore).toBeInstanceOf(ConvictionScore);
      expect(command.convictionScore.toString()).toBe('0.75');
    });
  });

  describe('requiredMargin の保持', () => {
    it('requiredMargin が Money インスタンスとして保持される', () => {
      // Given: 150 × 1100 × 0.04 = 6600 JPY
      const requiredMargin = Money.jpy('6600');

      // When
      const command = EntryCommand.of({
        pair: CurrencyPair('USD_JPY'),
        buySell: BuySell.BUY,
        lot: Lot.of(1100),
        reason: EntryReason.of('SMA クロス'),
        convictionScore: ConvictionScore.of('0.7'),
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: DUMMY_SNAPSHOT,
        requiredMargin,
      });

      // Then: requiredMargin は Money インスタンスとして同値で取得できる
      expect(command.requiredMargin).toBeInstanceOf(Money);
      expect(command.requiredMargin.equals(Money.jpy('6600'))).toBe(true);
    });

    it('requiredMargin が 0 円でも生成できる（境界）', () => {
      // Given
      const command = EntryCommand.of({
        pair: CurrencyPair('USD_JPY'),
        buySell: BuySell.BUY,
        lot: Lot.of(100),
        reason: EntryReason.of('SMA クロス'),
        convictionScore: ConvictionScore.of('0.5'),
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: DUMMY_SNAPSHOT,
        requiredMargin: Money.jpy('0'),
      });

      // Then
      expect(command.requiredMargin.equals(Money.jpy('0'))).toBe(true);
    });

    it('requiredMargin が負値の場合はエラー', () => {
      // Given/When/Then: requiredMargin が負値だと EntryCommand.of は throw する
      expect(() => EntryCommand.of({
        pair: CurrencyPair('USD_JPY'),
        buySell: BuySell.BUY,
        lot: Lot.of(100),
        reason: EntryReason.of('SMA クロス'),
        convictionScore: ConvictionScore.of('0.5'),
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: DUMMY_SNAPSHOT,
        requiredMargin: Money.jpy('-1'),
      })).toThrow('EntryCommand.requiredMargin は非負必須');
    });
  });
});
