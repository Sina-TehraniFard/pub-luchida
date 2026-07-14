import { describe, it, expect } from 'vitest';
import { PositionSizingService } from './PositionSizingService.js';
import { Balance } from '../domain/Balance.js';
import { Money } from '../domain/Money.js';
import { Rate } from '../domain/market/Rate.js';
import { Lot } from '../domain/position/Lot.js';
import { MaintenanceRatio } from '../domain/position/MaintenanceRatio.js';
import { MarginRate } from '../domain/position/MarginRate.js';
import { CurrencyPair } from '../domain/market/CurrencyPair.js';
import type { BalancePort } from '../port/BalancePort.js';
import type { RatePort } from '../port/RatePort.js';
import type { LotPolicy } from '../domain/position/LotPolicy.js';
import { RatePortError } from '../domain/error/RatePortError.js';

const PAIR = CurrencyPair('USD_JPY');
const CAPTURED_AT = new Date('2026-05-08T00:00:00.000Z');

class FakeBalancePort implements BalancePort {
  constructor(
    private readonly currentValue: Balance | null,
    private readonly freshNowResult: Balance | Error = Balance.of(Money.jpy('100000')),
  ) {}
  current(): Balance | null { return this.currentValue; }
  freshNow(): Promise<Balance> {
    if (this.freshNowResult instanceof Error) {
      return Promise.reject(this.freshNowResult);
    }
    return Promise.resolve(this.freshNowResult);
  }
}

class FakeRatePort implements RatePort {
  constructor(
    private readonly currentOfValue: Rate | null,
    private readonly currentFreshResult: Rate | Error = Rate.of('150', PAIR, CAPTURED_AT),
  ) {}
  currentOf(): Rate | null { return this.currentOfValue; }
  currentFresh(): Rate {
    if (this.currentFreshResult instanceof Error) {
      throw this.currentFreshResult;
    }
    return this.currentFreshResult;
  }
}

function buildService(
  balancePort: BalancePort,
  ratePort: RatePort,
  lotPolicy: LotPolicy,
  fallback: Balance = Balance.of(Money.jpy('50000')),
): PositionSizingService {
  return new PositionSizingService(
    balancePort,
    ratePort,
    lotPolicy,
    fallback,
    MaintenanceRatio.of('1.4'),
    MarginRate.of('0.04'),
  );
}

describe('PositionSizingService', () => {
  describe('execute()', () => {
    it('current() が成功したら fallback を使わず通常残高で LotPolicy を呼ぶ', () => {
      // Given
      const observed = { lastBalance: null as Balance | null };
      const lotPolicy: LotPolicy = {
        decide: (input) => {
          observed.lastBalance = input.balance();
          return Lot.of(1100);
        },
      };
      const service = buildService(
        new FakeBalancePort(Balance.of(Money.jpy('100000'))),
        new FakeRatePort(Rate.of('150', PAIR, CAPTURED_AT)),
        lotPolicy,
      );

      // When
      const lot = service.execute(PAIR);

      // Then
      expect(lot.equals(Lot.of(1100))).toBe(true);
      expect(observed.lastBalance!.equals(Balance.of(Money.jpy('100000')))).toBe(true);
    });

    it('current() が null なら fallback を使う', () => {
      // Given
      const fallback = Balance.of(Money.jpy('50000'));
      const observed = { lastBalance: null as Balance | null };
      const lotPolicy: LotPolicy = {
        decide: (input) => {
          observed.lastBalance = input.balance();
          return Lot.of(500);
        },
      };
      const service = buildService(
        new FakeBalancePort(null),
        new FakeRatePort(Rate.of('150', PAIR, CAPTURED_AT)),
        lotPolicy,
        fallback,
      );

      // When
      service.execute(PAIR);

      // Then
      expect(observed.lastBalance!.equals(fallback)).toBe(true);
    });

    it('currentOf() が null なら RatePortError(NOT_YET_AVAILABLE) を throw する', () => {
      // Given: 初回 tick 未到着
      const lotPolicy: LotPolicy = { decide: () => Lot.of(1100) };
      const service = buildService(
        new FakeBalancePort(Balance.of(Money.jpy('100000'))),
        new FakeRatePort(null),
        lotPolicy,
      );

      // When / Then
      expect(() => service.execute(PAIR)).toThrow(RatePortError);
      try {
        service.execute(PAIR);
      } catch (err) {
        expect((err as RatePortError).code).toBe('NOT_YET_AVAILABLE');
      }
    });
  });

  describe('executeSizing()', () => {
    it('SizingResult を返し、lot / rate / requiredMargin が一致する', () => {
      // Given: 残高あり / rate あり
      const lotPolicy: LotPolicy = { decide: () => Lot.of(1000) };
      const rate = Rate.of('150', PAIR, CAPTURED_AT);
      const service = buildService(
        new FakeBalancePort(Balance.of(Money.jpy('100000'))),
        new FakeRatePort(rate),
        lotPolicy,
      );

      // When
      const result = service.executeSizing(PAIR);

      // Then: requiredMargin = 150 × 1000 × 0.04 = 6000
      expect(result.lot().equals(Lot.of(1000))).toBe(true);
      expect(result.rate().equals(rate)).toBe(true);
      expect(result.requiredMargin().equals(Money.jpy('6000'))).toBe(true);
    });

    it('current() が null なら fallback を使って SizingResult を生成する', () => {
      // Given: 残高 null / rate あり / fallback 50000
      const fallback = Balance.of(Money.jpy('50000'));
      const observed = { lastBalance: null as Balance | null };
      const lotPolicy: LotPolicy = {
        decide: (input) => {
          observed.lastBalance = input.balance();
          return Lot.of(500);
        },
      };
      const rate = Rate.of('150', PAIR, CAPTURED_AT);
      const service = buildService(
        new FakeBalancePort(null),
        new FakeRatePort(rate),
        lotPolicy,
        fallback,
      );

      // When
      const result = service.executeSizing(PAIR);

      // Then: fallback が使われ、SizingResult が返る
      expect(observed.lastBalance!.equals(fallback)).toBe(true);
      expect(result.lot().equals(Lot.of(500))).toBe(true);
    });

    it('currentOf() が null なら RatePortError(NOT_YET_AVAILABLE) を throw する', () => {
      // Given: rate 未到着
      const lotPolicy: LotPolicy = { decide: () => Lot.of(1100) };
      const service = buildService(
        new FakeBalancePort(Balance.of(Money.jpy('100000'))),
        new FakeRatePort(null),
        lotPolicy,
      );

      // When / Then
      expect(() => service.executeSizing(PAIR)).toThrow(RatePortError);
      try {
        service.executeSizing(PAIR);
      } catch (err) {
        expect((err as RatePortError).code).toBe('NOT_YET_AVAILABLE');
      }
    });
  });

  describe('executeWithFresh()', () => {
    it('freshNow() / currentFresh() 成功で SizingResult を返す（NH-2: rate を閉じ込める）', async () => {
      // Given
      const lotPolicy: LotPolicy = { decide: () => Lot.of(1100) };
      const rate = Rate.of('150', PAIR, CAPTURED_AT);
      const service = buildService(
        new FakeBalancePort(Balance.of(Money.jpy('100000')), Balance.of(Money.jpy('200000'))),
        new FakeRatePort(rate, rate),
        lotPolicy,
      );

      // When
      const result = await service.executeWithFresh(PAIR);

      // Then
      expect(result.lot().equals(Lot.of(1100))).toBe(true);
      expect(result.rate().equals(rate)).toBe(true);
      // requiredMargin = 150 × 1100 × 0.04 = 6600
      expect(result.requiredMargin().equals(Money.jpy('6600'))).toBe(true);
    });

    it('freshNow() が throw したら fallback せず例外を伝播する', async () => {
      // Given
      const apiErr = new Error('Balance API down');
      const lotPolicy: LotPolicy = { decide: () => Lot.of(1100) };
      const rate = Rate.of('150', PAIR, CAPTURED_AT);
      const service = buildService(
        new FakeBalancePort(null, apiErr),
        new FakeRatePort(rate, rate),
        lotPolicy,
      );

      // When / Then
      await expect(service.executeWithFresh(PAIR)).rejects.toThrow('Balance API down');
    });

    it('currentFresh() が throw したら例外を伝播する', async () => {
      // Given
      const lotPolicy: LotPolicy = { decide: () => Lot.of(1100) };
      const rate = Rate.of('150', PAIR, CAPTURED_AT);
      const service = buildService(
        new FakeBalancePort(Balance.of(Money.jpy('100000')), Balance.of(Money.jpy('200000'))),
        new FakeRatePort(rate, RatePortError.stale(PAIR, 6000, 5000)),
        lotPolicy,
      );

      // When / Then
      await expect(service.executeWithFresh(PAIR)).rejects.toThrow(RatePortError);
    });
  });
});
