import { describe, it, expect } from 'vitest';
import Big from 'big.js';
import { TotalUnits } from './TotalUnits.js';
import { Lot } from './Lot.js';

describe('TotalUnits', () => {
  describe('of()', () => {
    it('0 で生成できる', () => {
      // Given: 下限値
      const total = TotalUnits.of(0);

      // When / Then: 0 で保持される
      expect(total.toString()).toBe('0');
    });

    it('100 で生成できる（単一 Lot 最小相当）', () => {
      // Given: Lot の最小単位相当
      const total = TotalUnits.of(100);

      // When / Then: 100 で保持される
      expect(total.toString()).toBe('100');
    });

    it('800,000 で生成できる（4 戦略 × 200,000 のシナリオ）', () => {
      // Given: 単一 Lot 上限を超える合計値
      const total = TotalUnits.of(800_000);

      // When / Then: そのまま保持される（上限なし）
      expect(total.toString()).toBe('800000');
    });

    it('文字列入力でも生成できる', () => {
      // Given: 文字列入力
      const total = TotalUnits.of('300000');

      // When / Then: 数値と同じ扱い
      expect(total.toString()).toBe('300000');
    });

    it('負の値を渡すと、エラーが投げられる', () => {
      // Given: 範囲外（負）
      // When / Then
      expect(() => TotalUnits.of(-1)).toThrow('TotalUnits は非負');
    });

    it('小数を渡すと、エラーが投げられる', () => {
      // Given: 小数値
      // When / Then: 整数チェックで弾かれる
      expect(() => TotalUnits.of(123.456)).toThrow('TotalUnits は整数');
    });
  });

  describe('zero()', () => {
    it('0 を返す', () => {
      // Given: ゼロ値
      const total = TotalUnits.zero();

      // When / Then
      expect(total.toString()).toBe('0');
    });
  });

  describe('fromLot()', () => {
    it('Lot.of(1000) から TotalUnits.of(1000) 相当を生成する', () => {
      // Given: Lot
      const lot = Lot.of(1000);

      // When: fromLot で変換
      const total = TotalUnits.fromLot(lot);

      // Then: TotalUnits.of(1000) と等価
      expect(total.equals(TotalUnits.of(1000))).toBe(true);
    });
  });

  describe('plus()', () => {
    it('300,000 + 300,000 = 600,000', () => {
      // Given: 2 戦略分の Lot 合計
      const a = TotalUnits.of(300_000);
      const b = TotalUnits.of(300_000);

      // When: 加算
      const sum = a.plus(b);

      // Then: 600,000
      expect(sum.equals(TotalUnits.of(600_000))).toBe(true);
    });

    it('zero に加算しても元の値', () => {
      // Given: ゼロと正の値
      const zero = TotalUnits.zero();
      const v = TotalUnits.of(100);

      // When / Then
      expect(zero.plus(v).equals(v)).toBe(true);
    });
  });

  describe('isExceedingSingleLotLimit()', () => {
    it('500,000 ちょうどでは false', () => {
      // Given: 単一 Lot 上限ちょうど
      const total = TotalUnits.of(500_000);

      // When / Then: 「超えた」ではない
      expect(total.isExceedingSingleLotLimit()).toBe(false);
    });

    it('500,001 では true', () => {
      // Given: 単一 Lot 上限を 1 超過
      const total = TotalUnits.of(500_001);

      // When / Then: 超えた
      expect(total.isExceedingSingleLotLimit()).toBe(true);
    });

    it('800,000 では true（4 戦略合算想定）', () => {
      // Given: 単一 Lot 上限を大きく超過
      const total = TotalUnits.of(800_000);

      // When / Then: 超えた
      expect(total.isExceedingSingleLotLimit()).toBe(true);
    });

    it('0 では false', () => {
      // Given: ゼロ値
      const total = TotalUnits.of(0);

      // When / Then
      expect(total.isExceedingSingleLotLimit()).toBe(false);
    });

    it('zero() の isExceedingSingleLotLimit() は false', () => {
      // Given: ゼロ値
      const total = TotalUnits.zero();

      // When / Then: 上限未満
      expect(total.isExceedingSingleLotLimit()).toBe(false);
    });
  });

  describe('toNumber()', () => {
    it('通常値で number に変換できる', () => {
      // Given: 100,000 の TotalUnits
      const total = TotalUnits.of(100_000);

      // When / Then: number 型で値が一致する
      expect(total.toNumber()).toBe(100_000);
    });

    it('zero() の toNumber() は 0', () => {
      // Given: ゼロ値
      const total = TotalUnits.zero();

      // When / Then
      expect(total.toNumber()).toBe(0);
    });
  });

  describe('toBig()', () => {
    it('内部の Big 値を取得できる', () => {
      // Given: 100,000 の TotalUnits
      const total = TotalUnits.of(100_000);

      // When: toBig() で内部の Big を取得
      const big = total.toBig();

      // Then: Big のインスタンスで、値が一致する
      expect(big).toBeInstanceOf(Big);
      expect(big.eq(new Big(100_000))).toBe(true);
    });
  });

  describe('equals()', () => {
    it('同じ値の TotalUnits どうしは等価と判定される', () => {
      // Given: 同じ 300,000 を 2 つ
      const a = TotalUnits.of(300_000);
      const b = TotalUnits.of(300_000);

      // When / Then: 等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる値の TotalUnits どうしは非等価と判定される', () => {
      // Given: 300,000 と 600,000
      const a = TotalUnits.of(300_000);
      const b = TotalUnits.of(600_000);

      // When / Then: 非等価
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('整数表示（小数点なし）', () => {
      // Given: 600,000
      const total = TotalUnits.of(600_000);

      // When / Then: 整数表記
      expect(total.toString()).toBe('600000');
    });

    it('0 は "0"', () => {
      // Given: ゼロ値
      const total = TotalUnits.zero();

      // When / Then
      expect(total.toString()).toBe('0');
    });

    it('文字列で渡しても整数表示になる', () => {
      // Given: 文字列入力
      const total = TotalUnits.of('500000');

      // When / Then
      expect(total.toString()).toBe('500000');
    });
  });
});
