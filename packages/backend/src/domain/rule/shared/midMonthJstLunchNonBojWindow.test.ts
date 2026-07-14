import { describe, it, expect } from 'vitest';
import { MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW } from './midMonthJstLunchNonBojWindow.js';

describe('MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW', () => {
  describe('block する時刻', () => {
    it('2024-05-20 JST 11:00 (= UTC 02:00) 月曜 非BOJ → block', () => {
      // 2024-05-20 is not a BOJ meeting day
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-20T02:00:00Z'))).toBe(true);
    });

    it('2024-05-17 JST 12:30 (= UTC 03:30) 金曜 非BOJ → block', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-17T03:30:00Z'))).toBe(true);
    });

    it('2024-05-16 00:00 UTC (JST 09:00) 日付は16-21日だが時刻外 → 通す', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-16T00:00:00Z'))).toBe(false);
    });
  });

  describe('BOJ 会合日は除外対象外（通常通り）', () => {
    it('2024-03-18 JST 12:00 BOJ会合日 → 通す', () => {
      // 2024-03-18 は BOJ 会合日
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-03-18T03:00:00Z'))).toBe(false);
    });

    it('2024-09-19 JST 11:30 BOJ会合日 → 通す', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-09-19T02:30:00Z'))).toBe(false);
    });
  });

  describe('16-21 日以外は対象外', () => {
    it('2024-05-15 12:00 UTC 02:00 JST → 通す（日付外）', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-15T03:00:00Z'))).toBe(false);
    });

    it('2024-05-22 12:00 JST → 通す（日付外）', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-22T03:00:00Z'))).toBe(false);
    });
  });

  describe('UTC 02-04 時以外は対象外', () => {
    it('2024-05-20 UTC 01:59 JST 10:59 → 通す', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-20T01:59:00Z'))).toBe(false);
    });

    it('2024-05-20 UTC 04:00 JST 13:00 → 通す（境界）', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-20T04:00:00Z'))).toBe(false);
    });
  });

  describe('JST 換算（UTC +9h）', () => {
    it('2024-05-19 17:00 UTC は JST 2024-05-20 02:00 → 日付だけ見ると 20 日だが UTC 時刻外 → 通す', () => {
      // UTC 02-04 判定は UTC 時刻で見る（JST 換算しない）のでこれは通過
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-19T17:00:00Z'))).toBe(false);
    });
  });

  describe('境界値（1 分ズレ / 日付境界の検知）', () => {
    // 本フィルターの採用根拠は「72 件の -7 pips/件 負け群の除外」。
    // 境界判定が 1 分でもズレると対象 72 件が別集合になり BT 成果が崩れるため
    // 境界の閉じ方（inclusive/exclusive）を明示的に検証する。

    it('UTC 02:00:00 ちょうど（下限 inclusive） → block', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-20T02:00:00Z'))).toBe(true);
    });

    it('UTC 03:59:59（上限直前、時間窓内） → block', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-20T03:59:59Z'))).toBe(true);
    });

    it('UTC 04:00:00 ちょうど（上限 exclusive） → 通す', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-20T04:00:00Z'))).toBe(false);
    });

    it('UTC 01:59:59（下限直前） → 通す', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-20T01:59:59Z'))).toBe(false);
    });

    it('日付境界: JST 16日 ちょうど（= UTC 15日 15:00 以降）かつ UTC 02-04 は JST 16日 11-13 → block 対象', () => {
      // UTC 2024-05-16T02:00:00 = JST 2024-05-16T11:00 → 16日 かつ JST 昼 → block
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-16T02:00:00Z'))).toBe(true);
    });

    it('日付境界: JST 15日（= UTC 15日）の昼 → 通す（16-21 外）', () => {
      // UTC 2024-05-15T02:00:00 = JST 2024-05-15T11:00
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-15T02:00:00Z'))).toBe(false);
    });

    it('日付境界: JST 21日 ちょうどの昼 → block', () => {
      // UTC 2024-05-21T02:00:00 = JST 2024-05-21T11:00
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-21T02:00:00Z'))).toBe(true);
    });

    it('日付境界: JST 22日の昼 → 通す（16-21 外）', () => {
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-22T02:00:00Z'))).toBe(false);
    });

    it('JST 日またぎ: UTC 2024-05-15T17:00:00 = JST 2024-05-16T02:00 → JST 日は 16 だが UTC 時刻 17 は範囲外 → 通す', () => {
      // UTC ベースで hour 判定する現実装の挙動確認。
      // もし誤って JST 時刻で判定する実装に書き換えられたら block になる ← 回帰検出
      expect(MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW.matches(new Date('2024-05-15T17:00:00Z'))).toBe(false);
    });
  });
});
