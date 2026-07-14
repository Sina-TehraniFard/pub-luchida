import type { TimeWindow } from './TimeWindowBlockEntryRule.js';
import { BOJ_MEETING_DATE_SET, toJstDateString } from './bojMeetingDates.js';

/**
 * 月中 JST 昼（非 BOJ 会合日）の時刻窓。
 *
 * 対象: 毎月 16-21 日 かつ JST 11:00-13:00（= UTC 02:00-03:59）
 *       ただし BOJ 金融政策決定会合が開催されている日は **除外しない**（= 通常通りエントリー）。
 *
 * 採用経緯:
 *   20 年 BT の post-hoc 分析で、この条件を満たす 72 件のトレードが
 *   平均 -7.01 pips / 件・勝率 22.2% と統計的に明確な負け群だった。
 *   特に SELL の平均 -10.00 pips / 件・勝率 17.4% が壊滅的。
 *   この 72 件を除外すると profit +505 pips（20 年）と統計的に安定した改善。
 *
 *   当初は BOJ 会合時期（16-21 日）由来の effect と仮説していたが、
 *   BOJ 会合日のみ除外では効果 +45 pips とほぼ無効。逆に BOJ 会合日は
 *   PF 1.439 / 平均 +8.09 pips と「稼ぎ所」であることが判明したため、
 *   BOJ 会合日を除外対象から外し、非会合日のみを block する設計に落ち着いた。
 *
 * BOJ 会合日リストのメンテナンス:
 *   bojMeetingDates.ts 参照。2027 年以降の会合日は要追加（毎年 9-10 月頃に日銀が公表）。
 *   リスト未更新時は会合日も誤って block されるが、年間影響は数十 pips 程度。
 */
export const MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW: TimeWindow = {
  label: '月中16-21日 JST昼（非BOJ日）',
  matches: (t: Date): boolean => {
    const jstDateStr = toJstDateString(t);
    const jstDay = parseInt(jstDateStr.slice(8, 10), 10);
    if (jstDay < 16 || jstDay > 21) return false;

    const utcHour = t.getUTCHours();
    if (utcHour < 2 || utcHour >= 4) return false;

    // BOJ 会合日は対象外（そのままエントリー許可）
    if (BOJ_MEETING_DATE_SET.has(jstDateStr)) return false;

    return true;
  },
};
