import { describe, it, expect } from 'vitest';
import { Tick } from './Tick.js';
import { Price } from '../Price.js';
import { TickTimestamp } from './TickTimestamp.js';

const ts = TickTimestamp.of(new Date('2024-01-15T10:30:00.000Z'));

describe('Tick', () => {
  describe('of()', () => {
    it('ask が bid より高い場合、Tick が生成される', () => {
      // Given: ask=150.5、bid=150.3 という正常な気配値
      const ask = Price.of('150.5');
      const bid = Price.of('150.3');

      // When: Tick.of() で生成する
      const tick = Tick.of(ask, bid, ts);

      // Then: インスタンスが生成される
      expect(tick).toBeInstanceOf(Tick);
    });

    it('ask と bid が同じ場合、エラーが投げられる（スプレッドゼロは存在しない）', () => {
      // Given: ask と bid が同値（実際の FX では起こりえない状態）
      const price = Price.of('150.0');

      // When / Then: スプレッドゼロは不正なためエラー
      expect(() => Tick.of(price, price, ts)).toThrow(
        'Tick: ask は bid より大きくなければなりません',
      );
    });

    it('ask が bid より低い場合、エラーが投げられる（逆ざや）', () => {
      // Given: ask < bid という逆ざやの気配値（データ異常）
      const ask = Price.of('150.0');
      const bid = Price.of('150.5');

      // When / Then: 逆ざやは不正なためエラー
      expect(() => Tick.of(ask, bid, ts)).toThrow(
        'Tick: ask は bid より大きくなければなりません',
      );
    });
  });

  describe('ask()', () => {
    it('ask() は生成時の ask 価格を返す', () => {
      // Given: ask=150.5 で生成した Tick
      const ask = Price.of('150.5');
      const bid = Price.of('150.3');
      const tick = Tick.of(ask, bid, ts);

      // When: ask() を呼ぶ
      const result = tick.ask();

      // Then: 生成時の ask 価格が返る
      expect(result.equals(ask)).toBe(true);
    });
  });

  describe('bid()', () => {
    it('bid() は生成時の bid 価格を返す', () => {
      // Given: bid=150.3 で生成した Tick
      const ask = Price.of('150.5');
      const bid = Price.of('150.3');
      const tick = Tick.of(ask, bid, ts);

      // When: bid() を呼ぶ
      const result = tick.bid();

      // Then: 生成時の bid 価格が返る
      expect(result.equals(bid)).toBe(true);
    });
  });

  describe('timestamp()', () => {
    it('timestamp() は生成時の時刻を返す', () => {
      // Given: 特定の時刻で生成した Tick
      const tick = Tick.of(Price.of('150.5'), Price.of('150.3'), ts);

      // When: timestamp() を呼ぶ
      const result = tick.timestamp();

      // Then: 生成時の TickTimestamp が返る
      expect(result.equals(ts)).toBe(true);
    });
  });

  describe('spread()', () => {
    it('spread() は ask と bid の差額を返す（浮動小数点誤差が出やすい値）', () => {
      // Given: 浮動小数点演算で誤差が出やすい ask=0.3、bid=0.1（差は 0.2）
      const ask = Price.of('0.3');
      const bid = Price.of('0.1');
      const tick = Tick.of(ask, bid, ts);

      // When: spread() を呼ぶ
      const spread = tick.spread();

      // Then: 誤差なく 0.2 が返る（0.3 - 0.1 = 0.19999... にならない）
      expect(spread.value().toString()).toBe('0.2');
    });
  });

  describe('midPrice()', () => {
    it('midPrice() は ask と bid の中間値を返す（浮動小数点誤差が出やすい値）', () => {
      // Given: 浮動小数点演算で誤差が出やすい ask=0.3、bid=0.1（中間は 0.2）
      const ask = Price.of('0.3');
      const bid = Price.of('0.1');
      const tick = Tick.of(ask, bid, ts);

      // When: midPrice() を呼ぶ
      const mid = tick.midPrice();

      // Then: 誤差なく 0.2 が返る
      expect(mid.toString()).toBe('0.2');
    });

    it('midPrice() は奇数の和でも正確な中間値を返す', () => {
      // Given: ask=150.5、bid=150.3（中間は 150.4）
      const ask = Price.of('150.5');
      const bid = Price.of('150.3');
      const tick = Tick.of(ask, bid, ts);

      // When: midPrice() を呼ぶ
      const mid = tick.midPrice();

      // Then: 150.4 が返る
      expect(mid.toString()).toBe('150.4');
    });
  });

  describe('equals()', () => {
    it('同じ ask・bid・timestamp の Tick どうしは等価と判定される', () => {
      // Given: ask・bid・timestamp がすべて同じ 2つの Tick
      const tickA = Tick.of(Price.of('150.5'), Price.of('150.3'), ts);
      const tickB = Tick.of(Price.of('150.5'), Price.of('150.3'), ts);

      // When: equals() で比較する
      // Then: 等価と判定される
      expect(tickA.equals(tickB)).toBe(true);
    });

    it('異なる ask の Tick どうしは非等価と判定される', () => {
      // Given: ask だけが異なる 2つの Tick
      const tickA = Tick.of(Price.of('150.5'), Price.of('150.3'), ts);
      const tickB = Tick.of(Price.of('150.6'), Price.of('150.3'), ts);

      // When: equals() で比較する
      // Then: ask が異なるため非等価と判定される
      expect(tickA.equals(tickB)).toBe(false);
    });
  });
});
