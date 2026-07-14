import { describe, it, expect } from 'vitest';
import Big from 'big.js';
import { BigSum } from './BigSum.js';
import { Ratio } from './Ratio.js';

describe('BigSum', () => {
  describe('zero()', () => {
    it('zero() はゼロ値の BigSum を返す', () => {
      // Given / When: ゼロを生成
      const sum = BigSum.zero();

      // Then: 内部 Big がゼロと等価
      expect(sum.toBig().eq(new Big(0))).toBe(true);
    });

    it('zero() の toString() は "0" を返す（toFixed 引数なしの挙動）', () => {
      // Given: ゼロ
      const sum = BigSum.zero();

      // When / Then: Big(0).toFixed() は "0"
      expect(sum.toString()).toBe('0');
    });
  });

  describe('addRatio()', () => {
    it('zero に Ratio(0.5) を加算すると、0.5 になる', () => {
      // Given: ゼロから始める
      const sum = BigSum.zero();

      // When: Ratio(0.5) を加算
      const next = sum.addRatio(Ratio.of('0.5'));

      // Then: 内部 Big が 0.5
      expect(next.toBig().eq(new Big('0.5'))).toBe(true);
    });

    it('複数の Ratio を連鎖加算しても、合計が正しく計算される', () => {
      // Given: 0.3, 0.4, 0.2 の Ratio を順に足す
      const sum = BigSum.zero()
        .addRatio(Ratio.of('0.3'))
        .addRatio(Ratio.of('0.4'))
        .addRatio(Ratio.of('0.2'));

      // When / Then: 合計が 0.9
      expect(sum.toBig().eq(new Big('0.9'))).toBe(true);
    });

    it('元の BigSum は addRatio で変化しない（不変性）', () => {
      // Given: zero
      const original = BigSum.zero();

      // When: Ratio を加算した新しい BigSum を作る
      const next = original.addRatio(Ratio.of('0.5'));

      // Then: 元の BigSum はゼロのまま、新しい BigSum は 0.5
      expect(original.toBig().eq(new Big(0))).toBe(true);
      expect(next.toBig().eq(new Big('0.5'))).toBe(true);
    });

    it('合計が 1.0 を超えても許容する（Ratio.add ならエラーになるケース）', () => {
      // Given: 0.7 と 0.5 を加算（合計 1.2）
      const sum = BigSum.zero()
        .addRatio(Ratio.of('0.7'))
        .addRatio(Ratio.of('0.5'));

      // When / Then: BigSum は 1.0 超を許容し、1.2 を保持する
      expect(sum.toBig().eq(new Big('1.2'))).toBe(true);
    });
  });

  describe('add()', () => {
    it('BigSum 同士を加算できる', () => {
      // Given: 0.3 と 0.4 の BigSum を 2 つ用意
      const a = BigSum.zero().addRatio(Ratio.of('0.3'));
      const b = BigSum.zero().addRatio(Ratio.of('0.4'));

      // When: 加算する
      const sum = a.add(b);

      // Then: 内部 Big が 0.7
      expect(sum.toBig().eq(new Big('0.7'))).toBe(true);
    });

    it('zero 同士の加算はゼロ', () => {
      // Given: ゼロを 2 つ
      const a = BigSum.zero();
      const b = BigSum.zero();

      // When: 加算
      const sum = a.add(b);

      // Then: ゼロ
      expect(sum.toBig().eq(new Big(0))).toBe(true);
    });

    it('元の BigSum は add で変化しない（不変性）', () => {
      // Given: 0.3 の BigSum と 0.4 の BigSum
      const a = BigSum.zero().addRatio(Ratio.of('0.3'));
      const b = BigSum.zero().addRatio(Ratio.of('0.4'));

      // When: 加算して新しい BigSum を作る
      const sum = a.add(b);

      // Then: a と b は変化しない、sum は 0.7
      expect(a.toBig().eq(new Big('0.3'))).toBe(true);
      expect(b.toBig().eq(new Big('0.4'))).toBe(true);
      expect(sum.toBig().eq(new Big('0.7'))).toBe(true);
    });
  });

  describe('fromRatio()', () => {
    it('Ratio.of(0.5) から BigSum を生成し、内部 Big が 0.5 になる', () => {
      // Given: Ratio
      const ratio = Ratio.of('0.5');

      // When: fromRatio で BigSum を生成
      const sum = BigSum.fromRatio(ratio);

      // Then: 内部 Big が 0.5 と等価
      expect(sum.toBig().eq(new Big('0.5'))).toBe(true);
    });
  });

  describe('isApproximatelyOne()', () => {
    it('1.0 ちょうどなら true', () => {
      // Given: 0.4 + 0.6 で 1.0
      const sum = BigSum.zero()
        .addRatio(Ratio.of('0.4'))
        .addRatio(Ratio.of('0.6'));

      // When / Then
      expect(sum.isApproximatelyOne(Ratio.EPSILON)).toBe(true);
    });

    it('1.0 + EPSILON 内（残余寄せ N=3 の典型誤差）なら true', () => {
      // Given: 0.3333333333 × 2 + 0.3333333334 = 1.0000000000 ぴったり
      // EPSILON 以内に収まる
      const sum = BigSum.zero()
        .addRatio(Ratio.of('0.3333333333'))
        .addRatio(Ratio.of('0.3333333333'))
        .addRatio(Ratio.of('0.3333333334'));

      // When / Then
      expect(sum.isApproximatelyOne(Ratio.EPSILON)).toBe(true);
    });

    it('1.0 - EPSILON を超える誤差（0.9）なら false', () => {
      // Given: 合計 0.9（差 0.1 > EPSILON）
      const sum = BigSum.zero()
        .addRatio(Ratio.of('0.4'))
        .addRatio(Ratio.of('0.5'));

      // When / Then
      expect(sum.isApproximatelyOne(Ratio.EPSILON)).toBe(false);
    });

    it('0.5 なら false', () => {
      // Given: 0.5
      const sum = BigSum.zero().addRatio(Ratio.of('0.5'));

      // When / Then
      expect(sum.isApproximatelyOne(Ratio.EPSILON)).toBe(false);
    });
  });

  describe('toBig()', () => {
    it('戻り値は Big のインスタンスで、内部値と一致する', () => {
      // Given: 0.5 を持つ BigSum
      const sum = BigSum.zero().addRatio(Ratio.of('0.5'));

      // When: toBig() で内部 Big を取得
      const big = sum.toBig();

      // Then: Big のインスタンスで値が 0.5
      expect(big).toBeInstanceOf(Big);
      expect(big.eq(new Big('0.5'))).toBe(true);
    });

    it('zero() の toBig() は Big(0) と一致', () => {
      // Given: ゼロ
      const sum = BigSum.zero();

      // When / Then: 内部 Big がゼロ
      expect(sum.toBig().eq(new Big(0))).toBe(true);
    });
  });

  describe('equals()', () => {
    it('同じ値の BigSum どうしは等価と判定される', () => {
      // Given: 0.5 の BigSum を 2 つ作る
      const a = BigSum.zero().addRatio(Ratio.of('0.5'));
      const b = BigSum.zero().addRatio(Ratio.of('0.5'));

      // When / Then: 等価
      expect(a.equals(b)).toBe(true);
    });

    it('zero() 同士は等価', () => {
      // Given: ゼロを 2 つ
      const a = BigSum.zero();
      const b = BigSum.zero();

      // When / Then: 等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる値の BigSum どうしは非等価と判定される', () => {
      // Given: 0.3 と 0.5
      const a = BigSum.zero().addRatio(Ratio.of('0.3'));
      const b = BigSum.zero().addRatio(Ratio.of('0.5'));

      // When / Then: 非等価
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('0.5 を持つ BigSum は "0.5" を返す', () => {
      // Given: 0.5 の BigSum
      const sum = BigSum.zero().addRatio(Ratio.of('0.5'));

      // When / Then: toFixed 引数なしなので末尾ゼロパディングなし
      expect(sum.toString()).toBe('0.5');
    });

    it('1.2 を持つ BigSum は "1.2" を返す（1.0 超の中間値もそのまま表示）', () => {
      // Given: 0.7 + 0.5 = 1.2
      const sum = BigSum.zero()
        .addRatio(Ratio.of('0.7'))
        .addRatio(Ratio.of('0.5'));

      // When / Then: 1.0 超でも素直に "1.2"
      expect(sum.toString()).toBe('1.2');
    });
  });
});
