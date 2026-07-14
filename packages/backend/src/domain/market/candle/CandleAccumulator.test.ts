import { describe, it, expect, beforeEach } from 'vitest';
import { Price } from '../Price.js';
import { TimeFrame, durationMs } from '../TimeFrame.js';
import { Tick } from '../tick/Tick.js';
import { TickTimestamp } from '../tick/TickTimestamp.js';
import { ConfirmedCandle } from './ConfirmedCandle.js';
import { CandleOpenTime } from './CandleOpenTime.js';
import { CandleCloseTime } from './CandleCloseTime.js';
import { CandleAccumulator } from './CandleAccumulator.js';

// ── テストヘルパー ──────────────────────────────────────────

const price = (v: string) => Price.of(v);

/**
 * GMO 規約の確定足を作る（closeTime = openTime + duration - 1）。
 * 期待値はリテラルで書くため、検証対象の accumulate を使わずに直接組み立てる。
 */
const gmoCandle = (
  close: string,
  openIso: string,
  timeFrame: TimeFrame = TimeFrame.ONE_MINUTE,
): ConfirmedCandle => {
  const openMs = new Date(openIso).getTime();
  const p = Price.of(close);
  return ConfirmedCandle.of({
    open: p,
    high: p,
    low: p,
    close: p,
    openTime: CandleOpenTime.of(new Date(openMs)),
    closeTime: CandleCloseTime.of(new Date(openMs + durationMs(timeFrame) - 1)),
    timeFrame,
  });
};

const tick = (ask: string, bid: string, isoTime: string): Tick =>
  Tick.of(price(ask), price(bid), TickTimestamp.of(new Date(isoTime)));

// 1分足での基準時刻（UTC）
// 14:00:00.000 〜 14:00:59.999 → period 1
// 14:01:00.000 〜 14:01:59.999 → period 2
// 14:02:00.000 〜 14:02:59.999 → period 3

const T_14_00_00 = '2024-01-01T14:00:00.000Z';
const T_14_00_30 = '2024-01-01T14:00:30.000Z';
const T_14_01_00 = '2024-01-01T14:01:00.000Z';
const T_14_01_30 = '2024-01-01T14:01:30.000Z';
const T_14_02_00 = '2024-01-01T14:02:00.000Z';

// ── テスト ──────────────────────────────────────────────────
describe('CandleAccumulator', () => {
  let acc: CandleAccumulator;

  beforeEach(() => {
    acc = new CandleAccumulator(TimeFrame.ONE_MINUTE);
  });

  describe('初期状態', () => {
    it('tick が来る前は currentForming() が null', () => {
      expect(acc.currentForming()).toBeNull();
    });

    it('tick が来る前は lastConfirmed() が null', () => {
      expect(acc.lastConfirmed()).toBeNull();
    });
  });

  describe('最初の tick', () => {
    it('最初の tick で UPDATED を返す', () => {
      // Given
      const t = tick('151.001', '150.999', T_14_00_00);

      // When
      const event = acc.accumulate(t);

      // Then
      expect(event.type).toBe('UPDATED');
    });

    it('最初の tick で currentForming() が null でなくなる', () => {
      // Given
      const t = tick('151.001', '150.999', T_14_00_00);

      // When
      acc.accumulate(t);

      // Then
      expect(acc.currentForming()).not.toBeNull();
    });

    it('最初の tick の後も lastConfirmed() は null のまま', () => {
      // Given
      const t = tick('151.001', '150.999', T_14_00_00);

      // When
      acc.accumulate(t);

      // Then
      expect(acc.lastConfirmed()).toBeNull();
    });
  });

  describe('同じ期間の tick（UPDATED）', () => {
    it('同じ1分間内の tick は UPDATED を返す', () => {
      // Given: 14:00:00 で足を開く
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));

      // When: 同じ分（14:00:30）の tick
      const event = acc.accumulate(tick('151.101', '150.899', T_14_00_30));

      // Then
      expect(event.type).toBe('UPDATED');
    });

    it('同じ期間の tick が来ても lastConfirmed() は null のまま', () => {
      // Given
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));

      // When
      acc.accumulate(tick('151.101', '150.899', T_14_00_30));

      // Then
      expect(acc.lastConfirmed()).toBeNull();
    });

    it('高値更新: より高い bid の tick が来ると currentHigh が上がる', () => {
      // Given: bid = 150.999
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));

      // When: bid = 151.999（高値更新）
      acc.accumulate(tick('152.001', '151.999', T_14_00_30));

      // Then
      expect(acc.currentForming()!.currentHigh().equals(price('151.999'))).toBe(true);
    });

    it('安値更新: より低い bid の tick が来ると currentLow が下がる', () => {
      // Given: bid = 150.999
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));

      // When: bid = 149.999（安値更新）
      acc.accumulate(tick('150.001', '149.999', T_14_00_30));

      // Then
      expect(acc.currentForming()!.currentLow().equals(price('149.999'))).toBe(true);
    });
  });

  describe('新しい期間の tick（CONFIRMED）', () => {
    it('新しい1分間の tick は CONFIRMED を返す', () => {
      // Given: 14:00 の足を形成中
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));

      // When: 14:01 の tick（新しい期間）
      const event = acc.accumulate(tick('151.201', '151.199', T_14_01_00));

      // Then
      expect(event.type).toBe('CONFIRMED');
    });

    it('足が確定したら lastConfirmed() に確定足が入る', () => {
      // Given: 14:00 に2本の tick
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));  // bid = 150.999
      acc.accumulate(tick('151.201', '151.199', T_14_00_30));  // bid = 151.199

      // When: 14:01 の tick で足確定
      acc.accumulate(tick('151.301', '151.299', T_14_01_00));

      // Then
      const confirmed = acc.lastConfirmed()!;
      expect(confirmed).not.toBeNull();
      expect(confirmed.timeFrame).toBe(TimeFrame.ONE_MINUTE);
      expect(confirmed.open.equals(price('150.999'))).toBe(true);   // 最初の bid
      expect(confirmed.close.equals(price('151.199'))).toBe(true);  // 最後の bid
      expect(confirmed.high.equals(price('151.199'))).toBe(true);   // 最高 bid
      expect(confirmed.low.equals(price('150.999'))).toBe(true);    // 最低 bid
    });

    it('足確定後 currentForming() が新しい期間の足になる', () => {
      // Given
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));

      // When: 新しい足が始まる
      acc.accumulate(tick('151.501', '151.499', T_14_01_00));  // bid = 151.499

      // Then: forming の open は新しい tick の bid
      expect(acc.currentForming()!.openPrice().equals(price('151.499'))).toBe(true);
    });

    it('確定足の closeTime は期間終了時刻（開始 + 1分）', () => {
      // Given: 14:00 の足
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));

      // When: 14:01 で足確定
      acc.accumulate(tick('151.201', '151.199', T_14_01_00));

      // Then: closeTime は 14:01:00.000Z
      const confirmed = acc.lastConfirmed()!;
      expect(confirmed.closeTime.toDate().toISOString()).toBe(T_14_01_00);
    });

    it('2回目の確定: 14:02 の tick で 14:01 の足が確定する', () => {
      // Given: 14:00→14:01 の tick で 14:00 の足を確定
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));
      acc.accumulate(tick('151.201', '151.199', T_14_01_00));

      // When: 14:02 の tick で 14:01 の足が確定
      const event = acc.accumulate(tick('151.401', '151.399', T_14_02_00));

      // Then
      expect(event.type).toBe('CONFIRMED');
      const confirmed = acc.lastConfirmed()!;
      expect(confirmed.open.equals(price('151.199'))).toBe(true);  // 14:01 の bid
    });

    it('CONFIRMED 後の同じ期間 tick は UPDATED を返す', () => {
      // Given: 14:00→14:01 で足確定
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));
      acc.accumulate(tick('151.201', '151.199', T_14_01_00));

      // When: 同じ 14:01 内の tick
      const event = acc.accumulate(tick('151.301', '151.299', T_14_01_30));

      // Then
      expect(event.type).toBe('UPDATED');
    });
  });

  describe('1時間足での動作', () => {
    it('1時間足: 同じ時間内の tick は UPDATED を返す', () => {
      // Given: 1時間足 accumulator
      const hourAcc = new CandleAccumulator(TimeFrame.ONE_HOUR);
      hourAcc.accumulate(tick('151.001', '150.999', '2024-01-01T14:00:00.000Z'));

      // When: 同じ時間帯（14:30）の tick
      const event = hourAcc.accumulate(tick('151.101', '150.899', '2024-01-01T14:30:00.000Z'));

      // Then
      expect(event.type).toBe('UPDATED');
    });

    it('1時間足: 次の時間帯の tick は CONFIRMED を返す', () => {
      // Given
      const hourAcc = new CandleAccumulator(TimeFrame.ONE_HOUR);
      hourAcc.accumulate(tick('151.001', '150.999', '2024-01-01T14:00:00.000Z'));

      // When: 15:00 の tick（次の時間帯）
      const event = hourAcc.accumulate(tick('151.101', '150.899', '2024-01-01T15:00:00.000Z'));

      // Then
      expect(event.type).toBe('CONFIRMED');
    });
  });

  describe('seedHistory()', () => {
    it('seedHistory で設定した足が lastConfirmed() で取得できる', () => {
      // Given: 確定足を手動でセット
      const confirmed = (() => {
        const tmpAcc = new CandleAccumulator(TimeFrame.ONE_MINUTE);
        tmpAcc.accumulate(tick('151.001', '150.999', T_14_00_00));
        tmpAcc.accumulate(tick('151.201', '151.199', T_14_01_00));
        return tmpAcc.lastConfirmed()!;
      })();

      // When: seedHistory() で設定する
      acc.seedHistory([confirmed]);

      // Then: lastConfirmed() がセットした足を返す
      expect(acc.lastConfirmed()).not.toBeNull();
      expect(acc.lastConfirmed()!.equals(confirmed)).toBe(true);
    });

    it('seedHistory 後の最初の tick は UPDATED を返す（CONFIRMED ではない）', () => {
      // Given: seedHistory() で確定足を設定
      const confirmed = (() => {
        const tmpAcc = new CandleAccumulator(TimeFrame.ONE_MINUTE);
        tmpAcc.accumulate(tick('151.001', '150.999', T_14_00_00));
        tmpAcc.accumulate(tick('151.201', '151.199', T_14_01_00));
        return tmpAcc.lastConfirmed()!;
      })();
      acc.seedHistory([confirmed]);

      // When: tick を受け取る
      const event = acc.accumulate(tick('151.301', '151.299', T_14_01_30));

      // Then: 足が新たに開くので UPDATED
      expect(event.type).toBe('UPDATED');
      expect(acc.currentForming()).not.toBeNull();
    });
  });

  describe('reconcileLastConfirmed()（公式値での確定足の訂正）', () => {
    it('直近の確定足を公式の確定足に差し替える', () => {
      // Given: tick で確定足を1本作る（close=150.999 ベース）
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));
      acc.accumulate(tick('151.201', '151.199', T_14_01_00));
      const internal = acc.lastConfirmed()!;

      // 公式の確定足（別の値）を用意
      const official = (() => {
        const tmpAcc = new CandleAccumulator(TimeFrame.ONE_MINUTE);
        tmpAcc.accumulate(tick('160.001', '159.999', T_14_00_00));
        tmpAcc.accumulate(tick('160.201', '160.199', T_14_01_00));
        return tmpAcc.lastConfirmed()!;
      })();

      // When: 公式値で訂正
      acc.reconcileLastConfirmed(official);

      // Then: lastConfirmed が公式の足に差し替わる
      expect(acc.lastConfirmed()!.equals(official)).toBe(true);
      expect(acc.lastConfirmed()!.equals(internal)).toBe(false);
    });

    it('形成中の足には触らない', () => {
      // Given: 確定足 + 形成中足がある状態
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));
      acc.accumulate(tick('151.201', '151.199', T_14_01_00));
      acc.accumulate(tick('151.301', '151.299', T_14_01_30));
      const formingBefore = acc.currentForming()!;

      const official = (() => {
        const tmpAcc = new CandleAccumulator(TimeFrame.ONE_MINUTE);
        tmpAcc.accumulate(tick('160.001', '159.999', T_14_00_00));
        tmpAcc.accumulate(tick('160.201', '160.199', T_14_01_00));
        return tmpAcc.lastConfirmed()!;
      })();

      // When
      acc.reconcileLastConfirmed(official);

      // Then: 形成中足は同一インスタンスのまま
      expect(acc.currentForming()).toBe(formingBefore);
    });

    it('別時間足の確定足を渡すとエラーになる', () => {
      // Given: 1分足の accumulator に 1時間足の確定足を渡す
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));
      acc.accumulate(tick('151.201', '151.199', T_14_01_00));

      const hourCandle = (() => {
        const hourAcc = new CandleAccumulator(TimeFrame.ONE_HOUR);
        hourAcc.accumulate(tick('160.001', '159.999', '2024-01-01T14:00:00.000Z'));
        hourAcc.accumulate(tick('160.201', '160.199', '2024-01-01T15:00:00.000Z'));
        return hourAcc.lastConfirmed()!;
      })();

      // When / Then
      expect(() => acc.reconcileLastConfirmed(hourCandle)).toThrow(
        '別時間足の足は受け付けません',
      );
    });

    it('GMO規約の確定足が形成中足のひとつ前なら受け入れる（throwしない）', () => {
      // Given: 14:00 期間で確定 → 14:01 期間の足を形成中（forming.openTime=14:01:00）
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));
      acc.accumulate(tick('151.201', '151.199', T_14_01_00));

      // 公式の 14:00 確定足（openTime=14:00:00 < forming.openTime=14:01:00）。
      // GMO 規約では closeTime=14:00:59.999 だが、判定は openTime で行うので通る。
      const official = gmoCandle('160.000', '2024-01-01T14:00:00.000Z');

      // When / Then
      expect(() => acc.reconcileLastConfirmed(official)).not.toThrow();
      expect(acc.lastConfirmed()!.openTime.toDate().toISOString()).toBe(
        '2024-01-01T14:00:00.000Z',
      );
    });

    it('GMO規約でも形成中足と同じ足境界の確定足は受け付けない', () => {
      // Given: forming.openTime=14:01:00
      acc.accumulate(tick('151.001', '150.999', T_14_00_00));
      acc.accumulate(tick('151.201', '151.199', T_14_01_00));

      // 公式が 14:01 足（= 形成中足そのものの足境界）を渡してくる。
      // 旧実装は closeTime(14:01:59.999) > openTime(14:01:00) で偶然弾けていたが、
      // 本質は「同じ足境界の足は確定足として受け付けない」。openTime で正しく弾く。
      const sameBoundary = gmoCandle('160.000', '2024-01-01T14:01:00.000Z');

      // When / Then
      expect(() => acc.reconcileLastConfirmed(sameBoundary)).toThrow(
        '足境界に踏み込んでいます',
      );
    });
  });
});
