import { describe, it, expect } from 'vitest';
import { ConvictionScore } from './ConvictionScore.js';

describe('ConvictionScore', () => {
  describe('生成', () => {
    it('0.0〜1.0 の範囲の値で確信度が生成される', () => {
      // Given: 有効な確信度の文字列
      const value = '0.75';

      // When: ConvictionScore.of() で生成する
      const score = ConvictionScore.of(value);

      // Then: 同じ値が文字列で取り出せる
      expect(score.toString()).toBe('0.75');
    });

    it('0.0 ちょうどで確信度が生成される（境界値）', () => {
      // Given: 下限境界値
      // When: ConvictionScore.of() で生成する
      const score = ConvictionScore.of('0.0');

      // Then: 正常に生成される
      expect(score.toString()).toBe('0');
    });

    it('1.0 ちょうどで確信度が生成される（境界値）', () => {
      // Given: 上限境界値
      // When: ConvictionScore.of() で生成する
      const score = ConvictionScore.of('1.0');

      // Then: 正常に生成される
      expect(score.toString()).toBe('1');
    });

    it('0.0 未満を渡すとエラーが投げられる', () => {
      // Given: 範囲外の負の値
      // When / Then: 0.0〜1.0 の範囲外のためエラー
      expect(() => ConvictionScore.of('-0.1')).toThrow('確信度は 0.0〜1.0 の範囲');
    });

    it('1.0 超を渡すとエラーが投げられる', () => {
      // Given: 範囲外の 1.0 超の値
      // When / Then: 0.0〜1.0 の範囲外のためエラー
      expect(() => ConvictionScore.of('1.1')).toThrow('確信度は 0.0〜1.0 の範囲');
    });
  });

  describe('ファクトリメソッド', () => {
    it('zero() は確信度ゼロを返す', () => {
      // Given: 確信度ゼロを表すファクトリメソッド
      // When: zero() で生成する
      const score = ConvictionScore.zero();

      // Then: 値は 0
      expect(score.toString()).toBe('0');
    });

    it('full() は確信度 1.0 を返す', () => {
      // Given: 確信度最大を表すファクトリメソッド
      // When: full() で生成する
      const score = ConvictionScore.full();

      // Then: 値は 1
      expect(score.toString()).toBe('1');
    });
  });

  describe('閾値判定', () => {
    it('確信度が閾値より高い場合、十分と判定される', () => {
      // Given: 確信度 0.8、閾値 0.3
      const score = ConvictionScore.of('0.8');
      const threshold = ConvictionScore.of('0.3');

      // When: isHighEnough() で判定する
      // Then: 閾値を超えているため true
      expect(score.isHighEnough(threshold)).toBe(true);
    });

    it('確信度が閾値より低い場合、不十分と判定される', () => {
      // Given: 確信度 0.3、閾値 0.8
      const score = ConvictionScore.of('0.3');
      const threshold = ConvictionScore.of('0.8');

      // When: isHighEnough() で判定する
      // Then: 閾値未満のため false
      expect(score.isHighEnough(threshold)).toBe(false);
    });

    it('確信度が閾値と同値の場合、十分と判定される（以上で比較）', () => {
      // Given: 確信度と閾値が同じ 0.5
      const score = ConvictionScore.of('0.5');
      const threshold = ConvictionScore.of('0.5');

      // When: isHighEnough() で判定する
      // Then: 同値は「以上」なので true
      expect(score.isHighEnough(threshold)).toBe(true);
    });
  });

  describe('等価比較', () => {
    it('同じ値の ConvictionScore どうしは等価と判定される', () => {
      // Given: 同じ確信度を表す 2つのインスタンス
      const a = ConvictionScore.of('0.5');
      const b = ConvictionScore.of('0.5');

      // When: equals() で比較する
      // Then: 等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる値の ConvictionScore どうしは非等価と判定される', () => {
      // Given: 異なる確信度の 2つのインスタンス
      const a = ConvictionScore.of('0.4');
      const b = ConvictionScore.of('0.6');

      // When: equals() で比較する
      // Then: 非等価
      expect(a.equals(b)).toBe(false);
    });
  });
});
