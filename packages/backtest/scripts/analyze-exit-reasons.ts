/**
 * BT 結果 JSON から決済理由の内訳を集計する。
 *
 * Usage: npx tsx scripts/analyze-exit-reasons.ts <path/to/result.json>
 *
 * TradeRecord.exitType は 3 値（TAKE_PROFIT / STOP_LOSS / FORCE_CLOSE）しかなく
 * 複数の ExitRule が同じ exitType を返すため、pnl / MFE / 保有期間のヒューリスティクスで
 * どの ExitRule が発火したか推定する。
 *
 * 推定ルール（SMA Cross + SL40 + Trail150/70 + Timed192bars 前提）:
 *   STOP_LOSS:
 *     pnl ≈ -40 (< -30)        → FixedSL
 *     pnl > -30 (損失小)        → SmaCrossExit (負け決済)
 *   TAKE_PROFIT:
 *     MFE < 150                 → SmaCrossExit (トレーリング未起動)
 *     MFE >= 150 かつ pnl ≈ MFE-70  → TrailingTP
 *     MFE >= 150 かつ pnl << MFE    → SmaCrossExit (起動後だが先にクロス)
 *   FORCE_CLOSE:
 *     保有 >= 48h (172800000ms) → TimedExit
 *     それ以外                  → BT 期間終了
 */

import { readFileSync } from 'node:fs';

interface Trade {
  exitType: 'TAKE_PROFIT' | 'STOP_LOSS' | 'FORCE_CLOSE';
  pnl: number;
  mfe: number;
  mae: number;
  holdingPeriodMs: number;
  side: 'BUY' | 'SELL';
}

type Rule =
  | 'FixedSL'
  | 'SmaCrossExit(loss)'
  | 'TrailingTP'
  | 'SmaCrossExit(profit)'
  | 'TimedExit'
  | 'BtEndForceClose';

const TRAIL_ACTIVATE_PIPS = 150;
const TRAIL_WIDTH_PIPS = 70;
const TIMED_EXIT_MS = 192 * 15 * 60 * 1000; // 172,800,000

function classify(t: Trade): Rule {
  if (t.exitType === 'STOP_LOSS') {
    return t.pnl < -30 ? 'FixedSL' : 'SmaCrossExit(loss)';
  }
  if (t.exitType === 'TAKE_PROFIT') {
    if (t.mfe < TRAIL_ACTIVATE_PIPS) return 'SmaCrossExit(profit)';
    // Trail は MFE - 70 ± スリッページ・足ラグ で決済
    const expectedTrailPnl = t.mfe - TRAIL_WIDTH_PIPS;
    const diff = Math.abs(t.pnl - expectedTrailPnl);
    return diff < 30 ? 'TrailingTP' : 'SmaCrossExit(profit)';
  }
  // FORCE_CLOSE
  return t.holdingPeriodMs >= TIMED_EXIT_MS - 60_000 ? 'TimedExit' : 'BtEndForceClose';
}

function summarize(trades: Trade[]): void {
  const groups = new Map<Rule, Trade[]>();
  for (const t of trades) {
    const rule = classify(t);
    if (!groups.has(rule)) groups.set(rule, []);
    groups.get(rule)!.push(t);
  }

  const total = trades.length;
  const totalWin = trades.filter(t => t.pnl > 0).length;

  console.log(`\n=== 決済理由の内訳（総 ${total} トレード、勝ち ${totalWin} = ${(totalWin / total * 100).toFixed(1)}%）===\n`);
  console.log('Rule                       | 件数  | 割合  | 勝率  | 平均PnL | 平均MFE | 平均MAE | 平均保有h');
  console.log('---------------------------|-------|-------|-------|---------|---------|---------|----------');

  const rulesOrder: Rule[] = [
    'FixedSL',
    'SmaCrossExit(loss)',
    'TrailingTP',
    'SmaCrossExit(profit)',
    'TimedExit',
    'BtEndForceClose',
  ];

  for (const rule of rulesOrder) {
    const list = groups.get(rule) ?? [];
    if (list.length === 0) continue;
    const winCount = list.filter(t => t.pnl > 0).length;
    const avgPnl = list.reduce((s, t) => s + t.pnl, 0) / list.length;
    const avgMfe = list.reduce((s, t) => s + t.mfe, 0) / list.length;
    const avgMae = list.reduce((s, t) => s + t.mae, 0) / list.length;
    const avgHold = list.reduce((s, t) => s + t.holdingPeriodMs, 0) / list.length / 3_600_000;
    console.log(
      `${rule.padEnd(27)}| ${String(list.length).padStart(5)} | ${(list.length / total * 100).toFixed(1).padStart(4)}% | ${(winCount / list.length * 100).toFixed(1).padStart(4)}% | ${avgPnl.toFixed(1).padStart(7)} | ${avgMfe.toFixed(1).padStart(7)} | ${avgMae.toFixed(1).padStart(7)} | ${avgHold.toFixed(1).padStart(8)}`,
    );
  }

  // 「取り逃がし」分析: 勝ちトレードで MFE ≥ 30 pips だったのに pnl < MFE/2 のもの
  console.log('\n=== 取り逃がし分析 (勝ちトレードのうち MFE≥30 かつ 実現益 < MFE/2) ===\n');
  const leftOnTable = trades.filter(
    t => t.pnl > 0 && t.mfe >= 30 && t.pnl < t.mfe / 2,
  );
  console.log(`対象: ${leftOnTable.length} / ${totalWin} 勝ちトレード中 (${(leftOnTable.length / totalWin * 100).toFixed(1)}%)`);
  if (leftOnTable.length > 0) {
    const avgMfe = leftOnTable.reduce((s, t) => s + t.mfe, 0) / leftOnTable.length;
    const avgPnl = leftOnTable.reduce((s, t) => s + t.pnl, 0) / leftOnTable.length;
    console.log(`このトレード群: 平均 MFE ${avgMfe.toFixed(1)} pips → 実現 ${avgPnl.toFixed(1)} pips (取り逃がし ${(avgMfe - avgPnl).toFixed(1)} pips/件)`);
    const totalLost = leftOnTable.reduce((s, t) => s + (t.mfe - t.pnl), 0);
    console.log(`累計取り逃がし: ${totalLost.toFixed(0)} pips`);

    const ruleCounts = new Map<Rule, number>();
    for (const t of leftOnTable) {
      const r = classify(t);
      ruleCounts.set(r, (ruleCounts.get(r) ?? 0) + 1);
    }
    console.log('\nこの取り逃がしを起こしたルール別内訳:');
    for (const [rule, count] of [...ruleCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${rule.padEnd(25)}: ${count} 件 (${(count / leftOnTable.length * 100).toFixed(1)}%)`);
    }
  }

  // トレーリング起動率
  console.log('\n=== トレーリング利確の起動状況 ===\n');
  const trailReached = trades.filter(t => t.mfe >= TRAIL_ACTIVATE_PIPS).length;
  const trailFired = groups.get('TrailingTP')?.length ?? 0;
  console.log(`MFE ≥ ${TRAIL_ACTIVATE_PIPS} pips に到達: ${trailReached} 件 (${(trailReached / total * 100).toFixed(1)}%)`);
  console.log(`トレーリング TP で決済:          ${trailFired} 件 (${(trailFired / total * 100).toFixed(1)}%)`);
  if (trailReached > 0) {
    console.log(`起動 → 発火率:                   ${(trailFired / trailReached * 100).toFixed(1)}%`);
  }
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: npx tsx scripts/analyze-exit-reasons.ts <result.json>');
    process.exit(1);
  }
  const raw = readFileSync(path, 'utf-8');
  const json = JSON.parse(raw);
  const trades: Trade[] = json.trades;
  console.log(`対象ファイル: ${path}`);
  console.log(`BT params: ${JSON.stringify(json.params)}`);
  summarize(trades);
}

main();
