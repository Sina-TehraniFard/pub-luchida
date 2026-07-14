import { describe, it, expect } from 'vitest';
import Big from 'big.js';
import { MaintenanceRatio } from './MaintenanceRatio.js';

describe('MaintenanceRatio', () => {
  describe('of()', () => {
    it('1.4 を渡すと、1.4 の MaintenanceRatio が生成される', () => {
      // Given: 通常の目標値（140%）
      const ratio = MaintenanceRatio.of(1.4);

      // When / Then: 内部の Big 値が 1.4 と等価
      expect(ratio.toBig().eq(new Big('1.4'))).toBe(true);
    });

    it('文字列入力でも生成できる', () => {
      // Given: 文字列で渡す
      const ratio = MaintenanceRatio.of('1.5');

      // When / Then: 数値と同じ扱い
      expect(ratio.toBig().eq(new Big('1.5'))).toBe(true);
    });

    it('1.0 ちょうどを渡すと、エラーが投げられる', () => {
      // Given: 強制決済ラインそのもの
      // When / Then: 1.0 以下は目標値として許容しない
      expect(() => MaintenanceRatio.of(1)).toThrow(
        'MaintenanceRatio は 1.0 超',
      );
    });

    it('1.0 未満を渡すと、エラーが投げられる', () => {
      // Given: 強制決済ラインを下回る値
      // When / Then: 1.0 以下は目標値として許容しない
      expect(() => MaintenanceRatio.of(0.9)).toThrow(
        'MaintenanceRatio は 1.0 超',
      );
    });

    it('0 を渡すと、エラーが投げられる', () => {
      // Given: ゼロ
      // When / Then: 1.0 以下は目標値として許容しない
      expect(() => MaintenanceRatio.of(0)).toThrow(
        'MaintenanceRatio は 1.0 超',
      );
    });

    it('負の値を渡すと、エラーが投げられる', () => {
      // Given: 負値
      // When / Then: 1.0 以下は目標値として許容しない
      expect(() => MaintenanceRatio.of(-0.5)).toThrow(
        'MaintenanceRatio は 1.0 超',
      );
    });

    it('1.0 をわずかに超える値は生成成功する（境界の上側）', () => {
      // Given: 1.0 を僅かに超える値
      const ratio = MaintenanceRatio.of('1.00000000001');

      // When / Then: 1.0 超なので許容される
      expect(ratio.toBig().eq(new Big('1.00000000001'))).toBe(true);
    });
  });

  describe('toNumber()', () => {
    it('内部の値を number で取得できる', () => {
      // Given: 1.4
      const ratio = MaintenanceRatio.of(1.4);

      // When: number に変換
      const n = ratio.toNumber();

      // Then: 1.4
      expect(n).toBe(1.4);
    });
  });

  describe('toBig()', () => {
    it('内部の Big 値を取得できる', () => {
      // Given: 1.4
      const ratio = MaintenanceRatio.of(1.4);

      // When: toBig() で内部の Big を取得
      const big = ratio.toBig();

      // Then: Big のインスタンスで、値が一致する
      expect(big).toBeInstanceOf(Big);
      expect(big.eq(new Big('1.4'))).toBe(true);
    });
  });

  describe('equals()', () => {
    it('同じ値の MaintenanceRatio どうしは等価と判定される', () => {
      // Given: 同じ 1.4 を 2 つ
      const a = MaintenanceRatio.of(1.4);
      const b = MaintenanceRatio.of(1.4);

      // When / Then: 等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる値の MaintenanceRatio どうしは非等価と判定される', () => {
      // Given: 1.4 と 1.5
      const a = MaintenanceRatio.of(1.4);
      const b = MaintenanceRatio.of(1.5);

      // When / Then: 非等価
      expect(a.equals(b)).toBe(false);
    });

    it('数値入力と文字列入力で同値なら等価と判定される', () => {
      // Given: 数値の 1.4 と文字列の '1.4'
      const a = MaintenanceRatio.of(1.4);
      const b = MaintenanceRatio.of('1.4');

      // When / Then: 内部 Big の eq により等価
      expect(a.equals(b)).toBe(true);
    });
  });

  describe('toString()', () => {
    it('小数を含む値はそのままのフォーマットで表示される', () => {
      // Given: 1.4
      const ratio = MaintenanceRatio.of(1.4);

      // When / Then: Big.toFixed() のフォーマット
      expect(ratio.toString()).toBe('1.4');
    });

    it('整数相当の値（2 など）も toFixed() の表記で表示される', () => {
      // Given: 2.0
      const ratio = MaintenanceRatio.of(2);

      // When / Then: Big('2').toFixed() は '2'
      expect(ratio.toString()).toBe('2');
    });

    it('文字列で渡した精度がそのまま保持される', () => {
      // Given: 文字列 '1.50'
      const ratio = MaintenanceRatio.of('1.50');

      // When / Then: Big の正規化により末尾ゼロは除去される
      expect(ratio.toString()).toBe('1.5');
    });
  });
});
