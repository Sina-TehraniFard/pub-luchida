import { describe, it, expect } from 'vitest';
import { CurrencyPair } from './CurrencyPair.js';
import { Pips } from './Pips.js';
import { Rate } from './Rate.js';

describe('Rate', () => {
  const usdJpy = CurrencyPair('USD_JPY');
  const eurUsd = CurrencyPair('EUR_USD');
  const capturedAt = new Date('2026-05-02T12:00:00.000Z');

  describe('of()', () => {
    it('正のレートで生成できる（USD_JPY 156.957）', () => {
      // Given / When: 正のレートで生成
      const rate = Rate.of('156.957', usdJpy, capturedAt);

      // Then: 値・ペア・キャプチャ時刻が保持される
      expect(rate.toBig().toFixed()).toBe('156.957');
      expect(rate.pair()).toBe(usdJpy);
      expect(rate.capturedAt()).toEqual(capturedAt);
    });

    it('number 引数からも生成できる', () => {
      // Given / When: number で生成
      const rate = Rate.of(1.0855, eurUsd, capturedAt);

      // Then
      expect(rate.toBig().toFixed()).toBe('1.0855');
    });

    it('ゼロを渡すと、エラーが投げられる', () => {
      // Given / When / Then: 0 はレートとして無効
      expect(() => Rate.of('0', usdJpy, capturedAt)).toThrow('Rate は正の数');
    });

    it('負値を渡すと、エラーが投げられる', () => {
      // Given / When / Then: 負値は無効
      expect(() => Rate.of('-1', usdJpy, capturedAt)).toThrow('Rate は正の数');
    });
  });

  describe('pair() / capturedAt()', () => {
    it('生成時のペアとキャプチャ時刻を取得できる', () => {
      // Given: USD_JPY のレート
      const rate = Rate.of('156.957', usdJpy, capturedAt);

      // When / Then
      expect(rate.pair()).toBe(usdJpy);
      expect(rate.capturedAt()).toEqual(capturedAt);
    });

    it('capturedAt() が返す Date を変更しても内部状態は影響を受けない', () => {
      // Given: 任意のレート
      const rate = Rate.of('156.957', usdJpy, capturedAt);
      const same = Rate.of('156.957', usdJpy, capturedAt);

      // When: 取得した Date を破壊的に書き換える
      rate.capturedAt().setTime(0);

      // Then: 内部の epoch ms は不変、equals が依然として成立
      expect(rate.equals(same)).toBe(true);
      expect(rate.capturedAt()).toEqual(capturedAt);
    });

    it('生成時に渡した Date を後から変更しても内部状態は影響を受けない', () => {
      // Given: 可変な Date を渡して生成
      const mutableCapturedAt = new Date(capturedAt.getTime());
      const rate = Rate.of('156.957', usdJpy, mutableCapturedAt);

      // When: 元の Date を書き換える
      mutableCapturedAt.setTime(0);

      // Then: Rate の内部時刻は元のまま
      expect(rate.capturedAt()).toEqual(capturedAt);
    });
  });

  describe('toBig()', () => {
    it('内部の Big 値を取得できる', () => {
      // Given: '156.957' の Rate
      const rate = Rate.of('156.957', usdJpy, capturedAt);

      // When: toBig() で内部 Big を取得
      const big = rate.toBig();

      // Then: 元の値が文字列化で取れる
      expect(big.toFixed()).toBe('156.957');
    });
  });

  describe('pipDifference()', () => {
    it('同じ通貨ペアどうしで差分 Pips を計算できる', () => {
      // Given: USD_JPY 156.957 と 156.952
      const a = Rate.of('156.957', usdJpy, capturedAt);
      const b = Rate.of('156.952', usdJpy, capturedAt);

      // When: 差分を計算
      const diff = a.pipDifference(b);

      // Then: 0.005 の Pips
      expect(diff.equals(Pips.of('0.005'))).toBe(true);
    });

    it('引かれる側が小さければ負の Pips になる', () => {
      // Given: USD_JPY 156.952 から 156.957 を引く
      const a = Rate.of('156.952', usdJpy, capturedAt);
      const b = Rate.of('156.957', usdJpy, capturedAt);

      // When
      const diff = a.pipDifference(b);

      // Then: -0.005
      expect(diff.equals(Pips.of('-0.005'))).toBe(true);
      expect(diff.isNegative()).toBe(true);
    });

    it('通貨ペアが異なると、エラーが投げられる', () => {
      // Given: USD_JPY と EUR_USD のレート
      const a = Rate.of('156.957', usdJpy, capturedAt);
      const b = Rate.of('1.0855', eurUsd, capturedAt);

      // When / Then: ペア不一致でエラー
      expect(() => a.pipDifference(b)).toThrow('Rate の通貨ペアが一致しません');
    });
  });

  describe('isFreshEnough()', () => {
    it('キャプチャ時刻から maxAge 以内なら true', () => {
      // Given: capturedAt から 500ms 経過した now、maxAge = 1000ms
      const rate = Rate.of('156.957', usdJpy, capturedAt);
      const now = new Date(capturedAt.getTime() + 500);

      // When / Then: 500ms <= 1000ms なので true
      expect(rate.isFreshEnough(now, 1000)).toBe(true);
    });

    it('キャプチャ時刻ちょうど（now = capturedAt）でも true', () => {
      // Given: now = capturedAt
      const rate = Rate.of('156.957', usdJpy, capturedAt);
      const now = new Date(capturedAt.getTime());

      // When / Then: 経過 0ms なので true
      expect(rate.isFreshEnough(now, 1000)).toBe(true);
    });

    it('maxAge 境界（now - capturedAt = maxAge）でも true', () => {
      // Given: 1000ms ちょうど経過
      const rate = Rate.of('156.957', usdJpy, capturedAt);
      const now = new Date(capturedAt.getTime() + 1000);

      // When / Then: 等号成立で true
      expect(rate.isFreshEnough(now, 1000)).toBe(true);
    });

    it('maxAge を超えると false', () => {
      // Given: 1001ms 経過、maxAge = 1000ms
      const rate = Rate.of('156.957', usdJpy, capturedAt);
      const now = new Date(capturedAt.getTime() + 1001);

      // When / Then: 期限切れ
      expect(rate.isFreshEnough(now, 1000)).toBe(false);
    });
  });

  describe('equals()', () => {
    it('全フィールド一致なら true', () => {
      // Given: 同じ値・ペア・時刻のレート 2 つ
      const a = Rate.of('156.957', usdJpy, capturedAt);
      const b = Rate.of('156.957', usdJpy, new Date(capturedAt.getTime()));

      // When / Then
      expect(a.equals(b)).toBe(true);
    });

    it('value だけ違うと false', () => {
      // Given: value だけ異なる
      const a = Rate.of('156.957', usdJpy, capturedAt);
      const b = Rate.of('156.952', usdJpy, capturedAt);

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('pair だけ違うと false', () => {
      // Given: pair だけ異なる（value は同じ '1' で揃える）
      const a = Rate.of('1', usdJpy, capturedAt);
      const b = Rate.of('1', eurUsd, capturedAt);

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('capturedAt だけ違うと false', () => {
      // Given: 時刻だけ異なる
      const a = Rate.of('156.957', usdJpy, capturedAt);
      const b = Rate.of('156.957', usdJpy, new Date(capturedAt.getTime() + 1));

      // When / Then
      expect(a.equals(b)).toBe(false);
    });
  });
});
