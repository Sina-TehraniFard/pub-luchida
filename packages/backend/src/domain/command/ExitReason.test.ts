import { describe, it, expect } from 'vitest';
import { ExitReason } from './ExitReason.js';

describe('ExitReason', () => {
  describe('生成（正常系）', () => {
    it('日本語の理由文字列で生成できる', () => {
      // Given: 日本語の理由文字列
      // When: of() で生成する
      const reason = ExitReason.of('利確ラインに到達');

      // Then: ExitReason のインスタンスである
      expect(reason).toBeInstanceOf(ExitReason);
    });

    it('英数字の理由文字列で生成できる', () => {
      // Given: 英数字の理由文字列
      // When: of() で生成する
      const reason = ExitReason.of('TAKE_PROFIT target reached');

      // Then: ExitReason のインスタンスである
      expect(reason).toBeInstanceOf(ExitReason);
    });
  });

  describe('生成（異常系）', () => {
    it('空文字列のときエラーが投げられる', () => {
      // Given: 空文字列
      // When / Then: 空文字は禁止のためエラー
      expect(() => ExitReason.of('')).toThrow('ExitReason は空文字列にできません');
    });

    it('スペースのみのときエラーが投げられる', () => {
      // Given: スペースのみの文字列
      // When / Then: 空白のみも禁止のためエラー
      expect(() => ExitReason.of('   ')).toThrow('ExitReason は空文字列にできません');
    });
  });

  describe('toString()', () => {
    it('生成時の文字列をそのまま返す', () => {
      // Given: 理由文字列
      // When: of() で生成し toString() を呼ぶ
      const reason = ExitReason.of('利確ラインに到達');

      // Then: 元の値がそのまま返る
      expect(reason.toString()).toBe('利確ラインに到達');
    });

    it('英数字の理由文字列でも toString() で元の値が返る', () => {
      // Given: 英数字の理由文字列
      // When: of() で生成し toString() を呼ぶ
      const reason = ExitReason.of('TAKE_PROFIT target reached');

      // Then: 元の値がそのまま返る
      expect(reason.toString()).toBe('TAKE_PROFIT target reached');
    });
  });

  describe('equals()', () => {
    it('同一インスタンスとの比較は等価（反射律）', () => {
      // Given: ExitReason インスタンス
      const a = ExitReason.of('損切りラインに到達');

      // When / Then: 自身と比較すると等価
      expect(a.equals(a)).toBe(true);
    });

    it('同じ値を持つ ExitReason どうしは等価と判定される', () => {
      // Given: 同じ文字列から生成した2つの ExitReason
      const a = ExitReason.of('損切りラインに到達');
      const b = ExitReason.of('損切りラインに到達');

      // When / Then: 同じ内容なので等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる値を持つ ExitReason は非等価と判定される', () => {
      // Given: 異なる文字列から生成した2つの ExitReason
      const a = ExitReason.of('利確ラインに到達');
      const b = ExitReason.of('損切りラインに到達');

      // When / Then: 内容が異なるので非等価
      expect(a.equals(b)).toBe(false);
    });

    it('対称律：a.equals(b) と b.equals(a) は同じ結果を返す', () => {
      // Given: 同じ文字列から生成した2つの ExitReason
      const a = ExitReason.of('SMAデッドクロス確認');
      const b = ExitReason.of('SMAデッドクロス確認');

      // When / Then: どちら向きに比較しても等価
      expect(a.equals(b)).toBe(true);
      expect(b.equals(a)).toBe(true);
    });
  });
});
