import { describe, it, expect } from 'vitest';
import Big from 'big.js';
import { MarketDataRateAdapter } from './MarketDataRateAdapter.js';
import { Tick } from '../domain/market/tick/Tick.js';
import { Price } from '../domain/market/Price.js';
import { TickTimestamp } from '../domain/market/tick/TickTimestamp.js';
import { CurrencyPair } from '../domain/market/CurrencyPair.js';
import type { MarketDataPort } from '../port/MarketDataPort.js';
import type { Clock } from '../port/Clock.js';
import { RatePortError } from '../domain/error/RatePortError.js';

const PAIR = CurrencyPair('USD_JPY');
const OTHER_PAIR = CurrencyPair('EUR_USD');

class FakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return this.current; }
  set(date: Date): void { this.current = new Date(date.getTime()); }
}

class FakeMarketDataPort implements MarketDataPort {
  private listeners: Array<(t: Tick) => void> = [];
  connect(): Promise<void> { return Promise.resolve(); }
  disconnect(): Promise<void> { return Promise.resolve(); }
  subscribe(onTick: (t: Tick) => void): () => void {
    this.listeners.push(onTick);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== onTick);
    };
  }
  emit(tick: Tick): void {
    for (const l of this.listeners) l(tick);
  }
  listenerCount(): number {
    return this.listeners.length;
  }
}

function buildTick(bid: string, capturedAt: Date): Tick {
  const ask = Price.of(new Big(bid).plus('0.01').toFixed());
  return Tick.of(ask, Price.of(bid), TickTimestamp.of(capturedAt));
}

describe('MarketDataRateAdapter', () => {
  describe('currentOf()', () => {
    it('Tick 未到着時は null', () => {
      // Given
      const port = new FakeMarketDataPort();
      const clock = new FakeClock(new Date('2026-05-08T00:00:00.000Z'));
      const adapter = new MarketDataRateAdapter(port, PAIR, clock, 5000);
      adapter.start();

      // When / Then
      expect(adapter.currentOf(PAIR)).toBeNull();
    });

    it('Tick 受信後は最新 bid を Rate として返す', () => {
      // Given
      const port = new FakeMarketDataPort();
      const tickAt = new Date('2026-05-08T00:00:00.000Z');
      const clock = new FakeClock(tickAt);
      const adapter = new MarketDataRateAdapter(port, PAIR, clock, 5000);
      adapter.start();

      // When
      port.emit(buildTick('150.123', tickAt));

      // Then
      const rate = adapter.currentOf(PAIR);
      expect(rate).not.toBeNull();
      expect(rate!.toBig().toFixed()).toBe('150.123');
    });

    it('バインド外の pair を渡すと RatePortError(PAIR_MISMATCH) を throw', () => {
      // Given
      const port = new FakeMarketDataPort();
      const adapter = new MarketDataRateAdapter(port, PAIR, new FakeClock(new Date()), 5000);

      // When / Then
      try {
        adapter.currentOf(OTHER_PAIR);
        expect.fail('throw されなかった');
      } catch (err) {
        expect(err).toBeInstanceOf(RatePortError);
        expect((err as RatePortError).code).toBe('PAIR_MISMATCH');
      }
    });
  });

  describe('currentFresh()', () => {
    it('Tick 未到着時は RatePortError(NOT_YET_AVAILABLE) を throw', () => {
      // Given
      const port = new FakeMarketDataPort();
      const adapter = new MarketDataRateAdapter(port, PAIR, new FakeClock(new Date()), 5000);
      adapter.start();

      // When / Then
      try {
        adapter.currentFresh(PAIR);
        expect.fail('throw されなかった');
      } catch (err) {
        expect(err).toBeInstanceOf(RatePortError);
        expect((err as RatePortError).code).toBe('NOT_YET_AVAILABLE');
      }
    });

    it('閾値内なら最新 Rate を返す', () => {
      // Given
      const port = new FakeMarketDataPort();
      const tickAt = new Date('2026-05-08T00:00:00.000Z');
      const clock = new FakeClock(tickAt);
      const adapter = new MarketDataRateAdapter(port, PAIR, clock, 5000);
      adapter.start();
      port.emit(buildTick('150.123', tickAt));

      // When
      clock.set(new Date(tickAt.getTime() + 5000)); // ちょうど閾値
      const rate = adapter.currentFresh(PAIR);

      // Then
      expect(rate.toBig().toFixed()).toBe('150.123');
    });

    it('閾値超過で RatePortError(STALE) を throw', () => {
      // Given
      const port = new FakeMarketDataPort();
      const tickAt = new Date('2026-05-08T00:00:00.000Z');
      const clock = new FakeClock(tickAt);
      const adapter = new MarketDataRateAdapter(port, PAIR, clock, 5000);
      adapter.start();
      port.emit(buildTick('150.123', tickAt));

      // When
      clock.set(new Date(tickAt.getTime() + 5001));

      // Then
      try {
        adapter.currentFresh(PAIR);
        expect.fail('throw されなかった');
      } catch (err) {
        expect(err).toBeInstanceOf(RatePortError);
        expect((err as RatePortError).code).toBe('STALE');
      }
    });
  });

  describe('start() / stop()', () => {
    it('start() を 2 度呼んでも listener は 1 つだけ登録される', () => {
      // Given
      const port = new FakeMarketDataPort();
      const adapter = new MarketDataRateAdapter(port, PAIR, new FakeClock(new Date()), 5000);

      // When
      adapter.start();
      adapter.start();

      // Then
      expect(port.listenerCount()).toBe(1);
    });

    it('stop() で購読が解除される', () => {
      // Given
      const port = new FakeMarketDataPort();
      const adapter = new MarketDataRateAdapter(port, PAIR, new FakeClock(new Date()), 5000);
      adapter.start();

      // When
      adapter.stop();

      // Then
      expect(port.listenerCount()).toBe(0);
    });
  });
});
