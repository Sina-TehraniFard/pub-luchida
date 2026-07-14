import { describe, it, expect } from 'vitest';
import { Position } from './Position.js';
import { PositionId } from './PositionId.js';
import { Lot } from './Lot.js';
import { CurrencyPair } from '../market/CurrencyPair.js';
import { BuySell } from '../market/BuySell.js';
import { Price } from '../market/Price.js';
import { Timestamp } from '../market/Timestamp.js';
import { EntryCommand } from '../command/EntryCommand.js';
import { EntryResult } from '../market/EntryResult.js';
import { EntryReason } from '../command/EntryReason.js';
import { ConvictionScore } from '../market/ConvictionScore.js';
import { ExitResult } from '../market/ExitResult.js';
import { ExitCommand, ExitType } from '../command/ExitCommand.js';
import { ExitReason } from '../command/ExitReason.js';
import { Pips } from '../market/Pips.js';
import { StrategyName } from '../rule/StrategyName.js';
import { EntrySnapshot } from '../market/snapshot/EntrySnapshot.js';
import { Money } from '../Money.js';

const DUMMY_SNAPSHOT = EntrySnapshot.of({ convictionScore: '0.5', entryHour: 12, entryDayOfWeek: 3 });

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

function makeCommand(overrides?: { buySell?: BuySell; pair?: CurrencyPair }): EntryCommand {
  return EntryCommand.of({
    pair: overrides?.pair ?? CurrencyPair('USD_JPY'),
    buySell: overrides?.buySell ?? BuySell.BUY,
    lot: Lot.of(100),
    reason: EntryReason.of('SMAクロス'),
    convictionScore: ConvictionScore.of('0.8'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: DUMMY_SNAPSHOT,
    requiredMargin: Money.jpy('600'),
  });
}

function makeResult(overrides?: { positionId?: PositionId }): EntryResult {
  return EntryResult.of({
    positionId: overrides?.positionId ?? PositionId.from(UUID_A),
    entryPrice: Price.of('150.500'),
    executedAt: Timestamp.of(new Date('2024-01-15T10:00:00Z')),
  });
}

function makePosition(overrides?: { id?: PositionId; buySell?: BuySell }): Position {
  return Position.open(
    makeCommand({ buySell: overrides?.buySell }),
    makeResult({ positionId: overrides?.id }),
  );
}

describe('Position', () => {
  // -----------------------------------------------------------------------
  // 生成
  // -----------------------------------------------------------------------
  describe('生成', () => {
    it('BUY ポジションを open() で生成すると、全フィールドが渡した値と一致する', () => {
      // Given: BUY 方向のエントリーコマンドと約定結果
      const command = EntryCommand.of({
        pair: CurrencyPair('USD_JPY'),
        buySell: BuySell.BUY,
        lot: Lot.of(100),
        reason: EntryReason.of('SMAクロス'),
        convictionScore: ConvictionScore.of('0.8'),
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: DUMMY_SNAPSHOT,
        requiredMargin: Money.jpy('600'),
      });
      const result = EntryResult.of({
        positionId: PositionId.from(UUID_A),
        entryPrice: Price.of('150.500'),
        executedAt: Timestamp.of(new Date('2024-01-15T10:00:00Z')),
      });

      // When: open() でポジションを生成する
      const position = Position.open(command, result);

      // Then: 各フィールドが渡した値と等価になる
      expect(position.id.equals(PositionId.from(UUID_A))).toBe(true);
      expect(position.pair).toBe('USD_JPY');
      expect(position.buySell).toBe(BuySell.BUY);
      expect(position.lot.toNumber()).toBe(100);
      expect(position.entryPrice.toString()).toBe('150.5');
      expect(position.openedAt.equals(Timestamp.of(new Date('2024-01-15T10:00:00Z')))).toBe(true);
      expect(position.status).toBe('OPEN');
      expect(position.exitPrice).toBeNull();
      expect(position.closedAt).toBeNull();
    });

    it('SELL ポジションを open() で生成すると、buySell が SELL になる', () => {
      // Given: SELL 方向のエントリーコマンドと約定結果
      const command = EntryCommand.of({
        pair: CurrencyPair('EUR_JPY'),
        buySell: BuySell.SELL,
        lot: Lot.of(200),
        reason: EntryReason.of('SMAデッドクロス'),
        convictionScore: ConvictionScore.of('0.7'),
        strategyName: StrategyName.SMA_CROSS,
        entrySnapshot: DUMMY_SNAPSHOT,
        requiredMargin: Money.jpy('1200'),
      });
      const result = EntryResult.of({
        positionId: PositionId.from(UUID_A),
        entryPrice: Price.of('160.000'),
        executedAt: Timestamp.of(new Date('2024-02-20T08:30:00Z')),
      });

      // When: open() で SELL ポジションを生成する
      const position = Position.open(command, result);

      // Then: buySell が SELL である
      expect(position.buySell).toBe(BuySell.SELL);
    });

    it('未対応の通貨ペアを渡すと例外が投げられる', () => {
      // Given: ビジネスとして扱わない通貨ペア文字列
      // When / Then: CurrencyPair() の段階で例外が発生する
      expect(() => CurrencyPair('XXX_YYY')).toThrow('未対応の通貨ペア');
    });

    it('空文字を PositionId に渡すと例外が投げられる', () => {
      // Given: 空文字列
      // When / Then: PositionId.from() の段階で例外が発生する
      expect(() => PositionId.from('')).toThrow('空にできません');
    });

    it('0 以下の価格を渡すと例外が投げられる（境界値: 0）', () => {
      // Given: 正でない価格文字列（境界値 "0"）
      // When / Then: Price.of() の段階で例外が発生する
      expect(() => Price.of('0')).toThrow();
    });

    it('負の価格を渡すと例外が投げられる', () => {
      // Given: 負の価格文字列
      // When / Then: Price.of() の段階で例外が発生する
      expect(() => Price.of('-1')).toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // close() — ポジション決済
  // -----------------------------------------------------------------------
  describe('close()', () => {
    it('OPEN のポジションを close すると status が CLOSED になる', () => {
      // Given: OPEN のポジション
      const position = makePosition();
      const exitResult = ExitResult.of({
        exitPrice: Price.of('151.000'),
        executedAt: Timestamp.of(new Date('2024-01-15T12:00:00Z')),
        profitLoss: Pips.of('5.0'),
      });

      // When: close() で決済する
      position.close(ExitCommand.of({ positionId: position.id, type: ExitType.TAKE_PROFIT, reason: ExitReason.of('目標到達') }), exitResult);

      // Then: status が CLOSED になり、exitPrice, closedAt, profitLoss が設定される
      expect(position.status).toBe('CLOSED');
      expect(position.exitPrice!.toString()).toBe('151');
      expect(position.closedAt!.equals(Timestamp.of(new Date('2024-01-15T12:00:00Z')))).toBe(true);
      expect(position.profitLoss!.toString()).toBe('5');
    });

    it('既にクローズ済みのポジションを再度 close すると例外が投げられる', () => {
      // Given: 既に決済済みのポジション
      const position = makePosition();
      const exitResult = ExitResult.of({
        exitPrice: Price.of('151.000'),
        executedAt: Timestamp.of(new Date('2024-01-15T12:00:00Z')),
        profitLoss: Pips.of('5.0'),
      });
      position.close(ExitCommand.of({ positionId: position.id, type: ExitType.TAKE_PROFIT, reason: ExitReason.of('目標到達') }), exitResult);

      // When / Then: 二重 close でエラー
      expect(() => position.close(ExitCommand.of({ positionId: position.id, type: ExitType.TAKE_PROFIT, reason: ExitReason.of('目標到達') }), exitResult)).toThrow('既にクローズ済みのポジションです');
    });
  });

  // -----------------------------------------------------------------------
  // restore() — DB からの復元
  // -----------------------------------------------------------------------
  describe('restore()', () => {
    it('OPEN 状態のポジションを復元できる', () => {
      // Given: OPEN のパラメータ
      const id = PositionId.from(UUID_A);

      // When: restore で復元
      const position = Position.restore({
        id,
        pair: CurrencyPair('USD_JPY'),
        buySell: BuySell.BUY,
        lot: Lot.of(100),
        entryPrice: Price.of('150.000'),
        openedAt: Timestamp.of(new Date('2024-01-15T10:00:00Z')),
        status: 'OPEN',
        strategyName: StrategyName.SMA_CROSS,
      });

      // Then: OPEN 状態で復元されている
      expect(position.status).toBe('OPEN');
      expect(position.id.equals(id)).toBe(true);
      expect(position.exitPrice).toBeNull();
    });

    it('CLOSED 状態のポジションを復元できる', () => {
      // Given: CLOSED のパラメータ
      const exitPrice = Price.of('151.000');
      const closedAt = Timestamp.of(new Date('2024-01-15T12:00:00Z'));

      // When: restore で復元
      const position = Position.restore({
        id: PositionId.from(UUID_A),
        pair: CurrencyPair('USD_JPY'),
        buySell: BuySell.BUY,
        lot: Lot.of(100),
        entryPrice: Price.of('150.000'),
        openedAt: Timestamp.of(new Date('2024-01-15T10:00:00Z')),
        status: 'CLOSED',
        exitPrice,
        closedAt,
        profitLoss: Pips.of('10.5'),
        strategyName: StrategyName.SMA_CROSS,
      });

      // Then: CLOSED 状態で復元されている
      expect(position.status).toBe('CLOSED');
      expect(position.exitPrice!.equals(exitPrice)).toBe(true);
      expect(position.closedAt!.equals(closedAt)).toBe(true);
      expect(position.profitLoss!.toString()).toBe('10.5');
    });
  });

  // -----------------------------------------------------------------------
  // equals() — エンティティとしての同一性
  // -----------------------------------------------------------------------
  describe('equals() — エンティティとしての同一性', () => {
    it('同じ id を持つ2つのポジションは等価と判定される', () => {
      // Given: 同じ id から生成した2つのポジション（JavaScript 上は別オブジェクト）
      const positionA = makePosition({ id: PositionId.from(UUID_A) });
      const positionB = makePosition({ id: PositionId.from(UUID_A) });

      // When: equals() で比較する
      // Then: id が同じなので等価
      expect(positionA.equals(positionB)).toBe(true);
    });

    it('参照が異なっていても id が同じなら equals() は true を返す（参照等価と値等価の違い）', () => {
      // Given: 同じ id から生成した2つのポジション
      const positionA = makePosition({ id: PositionId.from(UUID_A) });
      const positionB = makePosition({ id: PositionId.from(UUID_A) });

      // When: 参照等価（===）と値等価（equals）を両方確認する
      // Then: 参照は異なるが、エンティティとしては同一ポジション
      expect(positionA === positionB).toBe(false);
      expect(positionA.equals(positionB)).toBe(true);
    });

    it('異なる id を持つ2つのポジションは非等価と判定される（フィールドの内容が同じでも）', () => {
      // Given: 異なる id を持つ2つのポジション（他のフィールドは同一）
      const positionA = makePosition({ id: PositionId.from(UUID_A) });
      const positionB = makePosition({ id: PositionId.from(UUID_B) });

      // When: equals() で比較する
      // Then: id が違うので非等価（中身が同じでも id が違えば別のポジション）
      expect(positionA.equals(positionB)).toBe(false);
    });

    it('id が同じなら buySell が異なっていても等価と判定される（equals は id のみで判断する）', () => {
      // Given: 同じ id で buySell だけ異なる2つのポジション
      const positionBuy = makePosition({ id: PositionId.from(UUID_A), buySell: BuySell.BUY });
      const positionSell = makePosition({ id: PositionId.from(UUID_A), buySell: BuySell.SELL });

      // When: equals() で比較する
      // Then: id が同じなので等価（equals は id のみで判断する）
      expect(positionBuy.equals(positionSell)).toBe(true);
    });
  });
});
