import { Price } from '../Price.js';
import { TimeFrame } from '../TimeFrame.js';
import { CandleCloseTime } from './CandleCloseTime.js';
import { CandleOpenTime } from './CandleOpenTime.js';
import { ConfirmedCandle } from './ConfirmedCandle.js';

// テスト用ヘルパー
const p = (v: string) => Price.of(v);
const t = (iso: string) => CandleOpenTime.of(new Date(iso));
const ct = (iso: string) => CandleCloseTime.of(new Date(iso));

/** 正常なデフォルトパラメータ（陽線）*/
const defaultParams = {
  open: p('100'),
  high: p('110'),
  low: p('95'),
  close: p('105'),
  openTime: t('2024-01-01T00:00:00Z'),
  closeTime: ct('2024-01-01T00:01:00Z'),
  timeFrame: TimeFrame.ONE_MINUTE,
} as const;

describe('ConfirmedCandle', () => {
  // ─────────────────────────────────────────────
  // 生成（正常系）
  // ─────────────────────────────────────────────
  it('正常な OHLC で ConfirmedCandle が生成される', () => {
    // Given
    const { open, high, low, close, openTime, closeTime, timeFrame } = defaultParams;

    // When
    const candle = ConfirmedCandle.of({ open, high, low, close, openTime, closeTime, timeFrame });

    // Then
    expect(candle.open.equals(open)).toBe(true);
    expect(candle.high.equals(high)).toBe(true);
    expect(candle.low.equals(low)).toBe(true);
    expect(candle.close.equals(close)).toBe(true);
    expect(candle.openTime.equals(openTime)).toBe(true);
    expect(candle.closeTime.equals(closeTime)).toBe(true);
    expect(candle.timeFrame).toBe(TimeFrame.ONE_MINUTE);
  });

  // ─────────────────────────────────────────────
  // OHLC バリデーション（異常系）
  // ─────────────────────────────────────────────
  describe('OHLC バリデーション', () => {
    it('high が open より小さいときエラーが投げられる', () => {
      // Given: high(99) < open(100)
      expect(() =>
        ConfirmedCandle.of({
          ...defaultParams,
          open: p('100'),
          high: p('99'),
          low: p('95'),
          close: p('98'),
        }),
      ).toThrow('high は open 以上');
    });

    it('high が close より小さいときエラーが投げられる', () => {
      // Given: high(104) < close(105)
      expect(() =>
        ConfirmedCandle.of({
          ...defaultParams,
          open: p('100'),
          high: p('104'),
          low: p('95'),
          close: p('105'),
        }),
      ).toThrow('high は close 以上');
    });

    it('low が open より大きいときエラーが投げられる', () => {
      // Given: low(101) > open(100)
      expect(() =>
        ConfirmedCandle.of({
          ...defaultParams,
          open: p('100'),
          high: p('110'),
          low: p('101'),
          close: p('105'),
        }),
      ).toThrow('low は open 以下');
    });

    it('low が close より大きいときエラーが投げられる', () => {
      // Given: open(107) >= low(106) は通過するが low(106) > close(105) で不正
      expect(() =>
        ConfirmedCandle.of({
          ...defaultParams,
          open: p('107'),
          high: p('110'),
          low: p('106'),
          close: p('105'),
        }),
      ).toThrow('low は close 以下');
    });

    it('high が low より小さいときエラーが投げられる', () => {
      // Given: high(90) < low(95) — 上ヒゲが下ヒゲを下回る不正状態
      // Note: 実装のバリデーション順序上、high < open のガードが先に発火するため
      //       メッセージではなく例外の発生自体を検証する
      expect(() =>
        ConfirmedCandle.of({
          ...defaultParams,
          open: p('92'),
          high: p('90'),
          low: p('95'),
          close: p('92'),
        }),
      ).toThrow();
    });
  });

  // ─────────────────────────────────────────────
  // 時刻バリデーション（異常系）
  // ─────────────────────────────────────────────
  describe('時刻バリデーション', () => {
    it('openTime と closeTime が同じ場合はエラーになる', () => {
      // Given: openTime === closeTime（足の長さがゼロ）
      expect(() =>
        ConfirmedCandle.of({
          ...defaultParams,
          openTime: t('2024-01-01T00:01:00Z'),
          closeTime: ct('2024-01-01T00:01:00Z'),
        }),
      ).toThrow();
    });

    it('openTime が closeTime より後の場合はエラーになる', () => {
      // Given: openTime(00:02) > closeTime(00:01)
      expect(() =>
        ConfirmedCandle.of({
          ...defaultParams,
          openTime: t('2024-01-01T00:02:00Z'),
          closeTime: ct('2024-01-01T00:01:00Z'),
        }),
      ).toThrow();
    });
  });

  // ─────────────────────────────────────────────
  // isBullish() / isBearish()
  // ─────────────────────────────────────────────
  describe('isBullish() / isBearish()', () => {
    it('陽線（close > open）のとき isBullish() が true で isBearish() が false を返す', () => {
      // Given
      const candle = ConfirmedCandle.of({
        ...defaultParams,
        open: p('100'),
        close: p('105'),
      });

      // When / Then
      expect(candle.isBullish()).toBe(true);
      expect(candle.isBearish()).toBe(false);
    });

    it('陰線（close < open）のとき isBearish() が true で isBullish() が false を返す', () => {
      // Given
      const candle = ConfirmedCandle.of({
        ...defaultParams,
        open: p('105'),
        close: p('100'),
      });

      // When / Then
      expect(candle.isBearish()).toBe(true);
      expect(candle.isBullish()).toBe(false);
    });

    it('同値線（close === open）のとき isBullish() が true で isBearish() が false を返す', () => {
      // Given: ドジ足（実体なし）
      const candle = ConfirmedCandle.of({
        ...defaultParams,
        open: p('100'),
        close: p('100'),
      });

      // When / Then
      expect(candle.isBullish()).toBe(true);
      expect(candle.isBearish()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // bodySize()
  // ─────────────────────────────────────────────
  describe('bodySize()', () => {
    it('陽線のとき bodySize() は close - open の正の値を返す', () => {
      // Given
      const candle = ConfirmedCandle.of({
        ...defaultParams,
        open: p('100'),
        close: p('105'),
      });

      // When
      const size = candle.bodySize();

      // Then
      expect(size.equals(p('5'))).toBe(true);
    });

    it('陰線のとき bodySize() は open - close の正の値を返す', () => {
      // Given
      const candle = ConfirmedCandle.of({
        ...defaultParams,
        open: p('105'),
        close: p('100'),
      });

      // When
      const size = candle.bodySize();

      // Then
      expect(size.equals(p('5'))).toBe(true);
    });

    it('同値線のとき bodySize() は open の値をそのまま返す', () => {
      // Given: close === open のとき実体サイズは 0 だが Price は正の数のみ受け付けるため
      //        実装は open 値を返す仕様
      const candle = ConfirmedCandle.of({
        ...defaultParams,
        open: p('100'),
        close: p('100'),
      });

      // When
      const size = candle.bodySize();

      // Then: ゼロではなく open 値（100）が返る
      expect(size.equals(p('100'))).toBe(true);
    });

    it('小数点を含む価格でも bodySize() が正確に計算される', () => {
      // Given: FX レートのような小数点5桁の価格
      const candle = ConfirmedCandle.of({
        ...defaultParams,
        open: p('100.12300'),
        high: p('100.45600'),
        low: p('100.12300'),
        close: p('100.45600'),
      });

      // When
      const size = candle.bodySize();

      // Then: 100.456 - 100.123 = 0.333
      expect(size.equals(p('0.333'))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // equals()
  // ─────────────────────────────────────────────
  describe('equals()', () => {
    it('同じ OHLC・時刻・TimeFrame の ConfirmedCandle どうしは等価と判定される', () => {
      // Given
      const candle1 = ConfirmedCandle.of({ ...defaultParams });
      const candle2 = ConfirmedCandle.of({ ...defaultParams });

      // When / Then
      expect(candle1.equals(candle2)).toBe(true);
    });

    it('close が異なる ConfirmedCandle は非同値と判定される', () => {
      // Given
      const candle1 = ConfirmedCandle.of({ ...defaultParams });
      const candle2 = ConfirmedCandle.of({ ...defaultParams, close: p('106') });

      // When / Then
      expect(candle1.equals(candle2)).toBe(false);
    });

    it('openTime が異なる ConfirmedCandle は非同値と判定される', () => {
      // Given
      const candle1 = ConfirmedCandle.of({ ...defaultParams });
      const candle2 = ConfirmedCandle.of({
        ...defaultParams,
        openTime: t('2024-01-01T00:00:01Z'),
      });

      // When / Then
      expect(candle1.equals(candle2)).toBe(false);
    });

    it('TimeFrame が異なる ConfirmedCandle は非同値と判定される', () => {
      // Given
      const candle1 = ConfirmedCandle.of({ ...defaultParams, timeFrame: TimeFrame.ONE_MINUTE });
      const candle2 = ConfirmedCandle.of({ ...defaultParams, timeFrame: TimeFrame.ONE_HOUR });

      // When / Then
      expect(candle1.equals(candle2)).toBe(false);
    });
  });
});
