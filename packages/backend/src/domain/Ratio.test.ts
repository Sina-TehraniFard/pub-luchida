import { describe, it, expect } from 'vitest';
import Big from 'big.js';
import { Ratio } from './Ratio.js';
import { BigSum } from './BigSum.js';
import { Lot } from './position/Lot.js';

describe('Ratio', () => {
  describe('of()', () => {
    it('0.0 を渡すと、0.0 の Ratio が生成される', () => {
      // Given: 下限値
      const ratio = Ratio.of(0);

      // When / Then: 文字列表現が 10 桁固定の 0.0
      expect(ratio.toString()).toBe('0.0000000000');
    });

    it('0.5 を渡すと、0.5 の Ratio が生成される', () => {
      // Given: 中間値
      const ratio = Ratio.of(0.5);

      // When / Then: 文字列表現が 10 桁固定の 0.5
      expect(ratio.toString()).toBe('0.5000000000');
    });

    it('1.0 を渡すと、1.0 の Ratio が生成される', () => {
      // Given: 上限値
      const ratio = Ratio.of(1);

      // When / Then: 文字列表現が 10 桁固定の 1.0
      expect(ratio.toString()).toBe('1.0000000000');
    });

    it('小数第 11 位以下は切り捨てられる（0.12345678901 → 0.1234567890）', () => {
      // Given: 小数第 11 位を含む値
      const ratio = Ratio.of('0.12345678901');

      // When / Then: SCALE=10 で切り捨てられる
      expect(ratio.toString()).toBe('0.1234567890');
    });

    it('文字列入力でも生成できる', () => {
      // Given: 文字列で渡す
      const ratio = Ratio.of('0.25');

      // When / Then: 数値と同じ扱い（10 桁固定）
      expect(ratio.toString()).toBe('0.2500000000');
    });

    it('負の値を渡すと、エラーが投げられる', () => {
      // Given: 範囲外（負）
      // When / Then: 0.0〜1.0 の範囲外
      expect(() => Ratio.of(-0.1)).toThrow('Ratio は 0.0〜1.0');
    });

    it('0 未満にわずかに外れた値もエラーにする（丸め前判定の回帰）', () => {
      // Given: SCALE 切り捨てで 0 になる微小な負値
      // When / Then: 丸め前の生値で範囲チェックされ、エラーになる
      expect(() => Ratio.of('-0.00000000001')).toThrow('Ratio は 0.0〜1.0');
    });

    it('1.0 を超える値を渡すと、エラーが投げられる', () => {
      // Given: 範囲外（上限超過）
      // When / Then: 0.0〜1.0 の範囲外
      expect(() => Ratio.of(1.1)).toThrow('Ratio は 0.0〜1.0');
    });

    it('1.0 をわずかに超える値もエラーにする（丸め前判定の回帰）', () => {
      // Given: SCALE 切り捨てで 1.0 になる微小な超過値
      // When / Then: 丸め前の生値で範囲チェックされ、エラーになる
      expect(() => Ratio.of('1.00000000001')).toThrow('Ratio は 0.0〜1.0');
    });
  });

  describe('zero() / one()', () => {
    it('zero() は 0.0 の Ratio を返す', () => {
      // Given / When: ゼロを生成
      const ratio = Ratio.zero();

      // Then: 0.0（10 桁固定）
      expect(ratio.toString()).toBe('0.0000000000');
      expect(ratio.isZero()).toBe(true);
    });

    it('one() は 1.0 の Ratio を返す', () => {
      // Given / When: 1.0 を生成
      const ratio = Ratio.one();

      // Then: 1.0（10 桁固定）
      expect(ratio.toString()).toBe('1.0000000000');
      expect(ratio.equals(Ratio.of(1))).toBe(true);
    });
  });

  describe('EPSILON', () => {
    it('EPSILON は 1e-9 (Big("0.000000001")) と等価', () => {
      // Given / When: 公開定数を取得
      const epsilon = Ratio.EPSILON;

      // Then: Big('0.000000001') と eq で一致
      expect(epsilon.eq(new Big('0.000000001'))).toBe(true);
    });
  });

  describe('add()', () => {
    it('通常の和が計算できる', () => {
      // Given: 0.3 と 0.4
      const a = Ratio.of(0.3);
      const b = Ratio.of(0.4);

      // When: 加算する
      const sum = a.add(b);

      // Then: 0.7（10 桁固定）
      expect(sum.toString()).toBe('0.7000000000');
    });

    it('合計が 1.0 ちょうどなら成功する', () => {
      // Given: 合計 1.0 になる組み合わせ
      const a = Ratio.of(0.6);
      const b = Ratio.of(0.4);

      // When: 加算する
      const sum = a.add(b);

      // Then: 1.0（10 桁固定）
      expect(sum.toString()).toBe('1.0000000000');
    });

    it('合計が 1.0 を超えると、エラーが投げられる', () => {
      // Given: 合計 1.0 を超える組み合わせ
      const a = Ratio.of(0.7);
      const b = Ratio.of(0.4);

      // When / Then: 1.0 を超えるためエラー
      expect(() => a.add(b)).toThrow('Ratio の合計は 1.0 を超えられません');
    });
  });

  describe('addUnchecked()', () => {
    it('1.0 以下の通常加算でも BigSum を返す', () => {
      // Given: 0.3 と 0.4
      const a = Ratio.of(0.3);
      const b = Ratio.of(0.4);

      // When: addUnchecked で加算
      const sum = a.addUnchecked(b);

      // Then: BigSum インスタンスで、内部値は 0.7
      expect(sum).toBeInstanceOf(BigSum);
      expect(sum.toBig().eq(new Big('0.7'))).toBe(true);
    });

    it('合計が 1.0 ちょうどの BigSum を返せる', () => {
      // Given: 合計 1.0 になる組み合わせ
      const a = Ratio.of(0.6);
      const b = Ratio.of(0.4);

      // When: addUnchecked で加算
      const sum = a.addUnchecked(b);

      // Then: BigSum で内部値は 1.0
      expect(sum).toBeInstanceOf(BigSum);
      expect(sum.toBig().eq(new Big('1'))).toBe(true);
    });

    it('合計が 1.0 を超えてもエラーにならず、1.0 超の BigSum を返す', () => {
      // Given: 合計 1.0 を超える組み合わせ
      const a = Ratio.of(0.7);
      const b = Ratio.of(0.4);

      // When: addUnchecked は範囲外でも許容する
      const sum = a.addUnchecked(b);

      // Then: 1.1 の BigSum が返る（Ratio の不変条件を破らない中間型）
      expect(sum).toBeInstanceOf(BigSum);
      expect(sum.toBig().eq(new Big('1.1'))).toBe(true);
    });
  });

  describe('times()', () => {
    it('通常の積が計算できる', () => {
      // Given: 0.5 と 0.5
      const a = Ratio.of(0.5);
      const b = Ratio.of(0.5);

      // When: 積を計算
      const product = a.times(b);

      // Then: 0.25（10 桁固定）
      expect(product.toString()).toBe('0.2500000000');
    });

    it('ゼロとの積はゼロになる', () => {
      // Given: 0.5 と 0
      const a = Ratio.of(0.5);
      const b = Ratio.zero();

      // When: 積を計算
      const product = a.times(b);

      // Then: 0.0 でゼロ判定
      expect(product.isZero()).toBe(true);
    });

    it('積の結果は SCALE=10 で切り捨てられる', () => {
      // Given: 0.3333333333 × 0.3333333333 = 0.11111111108888888889 → 切り捨てで 0.1111111110
      const a = Ratio.of('0.3333333333');
      const b = Ratio.of('0.3333333333');

      // When: 積を計算
      const product = a.times(b);

      // Then: 小数第 11 位以下が切り捨てられる
      expect(product.toString()).toBe('0.1111111110');
    });
  });

  describe('applyTo()', () => {
    it('Lot に比率をかけて、100 の倍数に切り捨てた Lot を返す', () => {
      // Given: 1000 Lot に 0.5 をかける
      const lot = Lot.of(1000);
      const ratio = Ratio.of(0.5);

      // When: applyTo() で適用
      const applied = ratio.applyTo(lot);

      // Then: 500 Lot
      expect(applied.toNumber()).toBe(500);
    });

    it('結果が 100 の倍数にならない場合は切り捨てて 100 の倍数に揃える', () => {
      // Given: 1000 Lot に 0.333 をかける（= 333 → 切り捨てで 300）
      const lot = Lot.of(1000);
      const ratio = Ratio.of(0.333);

      // When: applyTo() で適用
      const applied = ratio.applyTo(lot);

      // Then: 300 Lot（100 の倍数に切り捨て）
      expect(applied.toNumber()).toBe(300);
    });

    it('1.0 をかけると、元の Lot と同じになる', () => {
      // Given: 500 Lot に 1.0 をかける
      const lot = Lot.of(500);
      const ratio = Ratio.one();

      // When: applyTo() で適用
      const applied = ratio.applyTo(lot);

      // Then: 元の Lot と等価
      expect(applied.equals(lot)).toBe(true);
    });

    it('結果が Lot の下限 100 未満になる場合は、Lot.of() の制約でエラーになる', () => {
      // Given: 100 Lot に 0.5 をかける（= 50 → 切り捨てで 0）
      const lot = Lot.of(100);
      const ratio = Ratio.of(0.5);

      // When / Then: 0 は Lot の制約に違反
      expect(() => ratio.applyTo(lot)).toThrow('Lotは100以上');
    });

    it('Ratio.zero() の applyTo は、結果が 0 になり Lot 制約違反でエラー', () => {
      // Given: 任意の Lot にゼロ比率をかける
      const lot = Lot.of(500);
      const zero = Ratio.zero();

      // When / Then: 0 Lot は Lot.of() の下限制約に違反
      // 「ゼロ配分は『その戦略では発注しない』を意味し、applyTo の結果として
      //  ゼロ Lot を作ろうとすると Lot 側で必ず弾かれる」契約を明示
      expect(() => zero.applyTo(lot)).toThrow('Lotは100以上');
    });
  });

  describe('isZero()', () => {
    it('zero() の Ratio は true を返す', () => {
      // Given: ゼロ
      const ratio = Ratio.zero();

      // When / Then: ゼロなので true
      expect(ratio.isZero()).toBe(true);
    });

    it('ゼロでない Ratio は false を返す', () => {
      // Given: 0.5
      const ratio = Ratio.of(0.5);

      // When / Then: ゼロではない
      expect(ratio.isZero()).toBe(false);
    });
  });

  describe('equals()', () => {
    it('同じ値の Ratio どうしは等価と判定される', () => {
      // Given: 同じ 0.5 を 2 つ
      const a = Ratio.of(0.5);
      const b = Ratio.of(0.5);

      // When / Then: 等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる値の Ratio どうしは非等価と判定される', () => {
      // Given: 0.3 と 0.5
      const a = Ratio.of(0.3);
      const b = Ratio.of(0.5);

      // When / Then: 非等価
      expect(a.equals(b)).toBe(false);
    });

    it('丸め後に同値になる Ratio どうしは等価と判定される', () => {
      // Given: 11 桁目以下が異なるが、SCALE=10 切り捨て後は同値
      const a = Ratio.of('0.12345678901');
      const b = Ratio.of('0.12345678909');

      // When / Then: 切り捨て後の値（0.1234567890）が同じなので等価
      expect(a.equals(b)).toBe(true);
    });
  });

  describe('toBig()', () => {
    it('内部の Big 値を取得できる', () => {
      // Given: 0.5 の Ratio
      const ratio = Ratio.of(0.5);

      // When: toBig() で内部の Big を取得
      const big = ratio.toBig();

      // Then: Big のインスタンスで、値が一致する
      expect(big).toBeInstanceOf(Big);
      expect(big.eq(new Big('0.5'))).toBe(true);
    });

    it('zero() の toBig() は Big(0) と一致', () => {
      // Given: zero
      const ratio = Ratio.zero();

      // When / Then: 内部 Big がゼロ
      expect(ratio.toBig().eq(new Big(0))).toBe(true);
    });
  });

  describe('toString()', () => {
    it('小数第 10 位までの固定表記で表示される', () => {
      // Given: 0.5
      const ratio = Ratio.of(0.5);

      // When / Then: 10 桁固定
      expect(ratio.toString()).toBe('0.5000000000');
    });

    it('ゼロも 10 桁固定で表示される', () => {
      // Given: 0
      const ratio = Ratio.zero();

      // When / Then: 0.0000000000
      expect(ratio.toString()).toBe('0.0000000000');
    });

    it('1.0 も 10 桁固定で表示される', () => {
      // Given: 1
      const ratio = Ratio.one();

      // When / Then: 1.0000000000
      expect(ratio.toString()).toBe('1.0000000000');
    });
  });

  describe('divideOne()', () => {
    it('n=1 は Ratio.one()', () => {
      // Given / When / Then
      expect(Ratio.divideOne(1).equals(Ratio.one())).toBe(true);
    });

    it('n=2 は 0.5', () => {
      // Given / When / Then
      expect(Ratio.divideOne(2).toString()).toBe('0.5000000000');
    });

    it('n=3 は 10桁切り捨てで 0.3333333333', () => {
      // Given / When / Then
      expect(Ratio.divideOne(3).toString()).toBe('0.3333333333');
    });

    it('n=7 は 10桁切り捨てで 0.1428571428', () => {
      // Given / When / Then
      expect(Ratio.divideOne(7).toString()).toBe('0.1428571428');
    });

    it('n=0 は throw', () => {
      // Given / When / Then
      expect(() => Ratio.divideOne(0)).toThrow(/正の整数/);
    });

    it('n が負は throw', () => {
      // Given / When / Then
      expect(() => Ratio.divideOne(-1)).toThrow(/正の整数/);
    });

    it('n が非整数は throw', () => {
      // Given / When / Then
      expect(() => Ratio.divideOne(2.5)).toThrow(/正の整数/);
    });
  });

  describe('complementOf()', () => {
    it('1 - 2*0.3333333333 = 0.3333333334（残余を末尾に寄せる）', () => {
      // Given
      const r = Ratio.divideOne(3);

      // When
      const last = Ratio.complementOf(r, 2);

      // Then
      expect(last.toString()).toBe('0.3333333334');
    });

    it('k=0 なら 1 を返す', () => {
      // Given / When
      const last = Ratio.complementOf(Ratio.divideOne(3), 0);

      // Then
      expect(last.equals(Ratio.one())).toBe(true);
    });

    it('k が負は throw', () => {
      // Given / When / Then
      expect(() => Ratio.complementOf(Ratio.divideOne(3), -1)).toThrow(/非負整数/);
    });

    it('結果が 0..1 範囲外（k * parts > 1）なら Ratio.of の検証で throw', () => {
      // Given: 0.6 × 2 = 1.2 で 1 - 1.2 = -0.2
      const r = Ratio.of('0.6');

      // When / Then
      expect(() => Ratio.complementOf(r, 2)).toThrow(/Ratio は 0\.0〜1\.0/);
    });
  });

  describe('divideOne + complementOf による残余寄せ（合計=1.0 厳密一致）', () => {
    it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 13])(
      'n=%i: head × (n-1) + last = 1.0（big.js 厳密一致）',
      (n) => {
        // Given
        const head = Ratio.divideOne(n);
        const last = Ratio.complementOf(head, n - 1);

        // When: head × (n-1) + last を Big で合算
        const sum = head
          .toBig()
          .times(n - 1)
          .plus(last.toBig());

        // Then
        expect(sum.eq(1)).toBe(true);
      },
    );
  });
});
