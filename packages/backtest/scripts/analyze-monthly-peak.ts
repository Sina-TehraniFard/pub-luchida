/**
 * BT 結果 JSON から「月の始まりからの累積含み益（pips）が閾値に一時でも到達した月」の割合を集計する。
 *
 * 対象: 円建てではなく pips 建て。Lot サイジングの影響を排除して戦略そのものの性能を見る。
 *
 * Usage: npx tsx scripts/analyze-monthly-peak.ts <path/to/result.json> [threshold_pips]
 *   threshold_pips: 月内ピーク pips 閾値（例 150）。省略時は 150。
 *
 * 算定ロジック:
 *   1. トレードを exitTime 順にソート
 *   2. 各月について、月初からの累積実現 PnL（pips）を追いながら、
 *      各トレード実行中の最大含み益ピーク = 累積実現 + T.mfePips を評価
 *   3. 月内ピークがスレッショルド以上なら hit
 *
 *   アルゴリズム（月 M 内、時系列）:
 *     cumulative = 0
 *     peak = 0
 *     for each T exiting in M (時系列):
 *       peak = max(peak, cumulative + T.mfePips)  // T 実行中の一瞬ピーク
 *       cumulative += T.pnlPips                    // T close 後の実現累積
 *       peak = max(peak, cumulative)               // close 直後も peak 候補
 *     if peak >= threshold_pips → hit
 *
 * 制限:
 *   - T が月を跨ぐ場合 (entry が M-1, exit が M)、T.mfePips が M-1 で起きた可能性もあるが、
 *     M に帰属させる。Lot 上限の影響を排除するためにも pips 建てで評価している
 *   - 1 position at a time を前提（複数同時保有なら別実装が必要）
 */

import { readFileSync } from 'node:fs';

interface Trade {
  entryTime: string;
  exitTime: string;
  pnlPips: number;
  mfePips: number;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: npx tsx scripts/analyze-monthly-peak.ts <result.json> [threshold_pips]');
    process.exit(1);
  }
  const thresholdPips = process.argv[3] ? Number(process.argv[3]) : 150;

  const json = JSON.parse(readFileSync(path, 'utf-8'));
  const trades: Trade[] = [...json.trades].sort(
    (a: Trade, b: Trade) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime(),
  );

  console.log(`対象ファイル: ${path}`);
  console.log(`戦略: ${json.strategy} / 維持率 ${json.params.targetMaintenanceRatio ?? 'risk ' + json.params.riskPct}`);
  console.log(`閾値: 月内累積含み益ピーク ${thresholdPips} pips\n`);

  // 月ごとに集計
  const monthlyPeak = new Map<string, number>();
  const tradesInMonth = new Map<string, Trade[]>();

  for (const t of trades) {
    const m = monthKey(t.exitTime);
    if (!tradesInMonth.has(m)) tradesInMonth.set(m, []);
    tradesInMonth.get(m)!.push(t);
  }

  for (const [m, mTrades] of tradesInMonth) {
    let cumulative = 0;
    let peak = 0;
    for (const t of mTrades) {
      // 実行中のピーク: 累積実現 + この T の MFE
      peak = Math.max(peak, cumulative + t.mfePips);
      // close 後の累積
      cumulative += t.pnlPips;
      peak = Math.max(peak, cumulative);
    }
    monthlyPeak.set(m, peak);
  }

  // 全月リスト
  const startDate = new Date(json.dateFrom);
  const endDate = new Date(json.dateTo);
  const allMonths: string[] = [];
  const cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  while (cur < endDate) {
    allMonths.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }

  const hits: { month: string; peak: number }[] = [];
  const histogram = new Map<number, number>();
  let activeMonths = 0;
  let skippedMonths = 0;

  for (const m of allMonths) {
    const p = monthlyPeak.get(m);
    if (p === undefined) {
      skippedMonths++;
      continue;
    }
    activeMonths++;
    // 50 pips 刻みで bucketing
    const bucket = Math.floor(p / 50) * 50;
    histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
    if (p >= thresholdPips) {
      hits.push({ month: m, peak: p });
    }
  }

  console.log(`BT 期間:            ${json.dateFrom.slice(0, 10)} 〜 ${json.dateTo.slice(0, 10)}`);
  console.log(`全月数:             ${allMonths.length}`);
  console.log(`取引あり月数:       ${activeMonths}`);
  console.log(`取引なし月数:       ${skippedMonths}`);
  console.log(`閾値達成月数:       ${hits.length}`);
  console.log(`達成率 (全月中):    ${(hits.length / allMonths.length * 100).toFixed(1)}%`);
  console.log(`達成率 (取引あり月):${(hits.length / activeMonths * 100).toFixed(1)}%`);

  // 年代別
  console.log(`\n年代別の ${thresholdPips} pips 達成月:`);
  const byDecade = new Map<string, { hit: number; total: number }>();
  for (const m of allMonths) {
    const year = parseInt(m.slice(0, 4), 10);
    const decade = `${Math.floor(year / 5) * 5}-${Math.floor(year / 5) * 5 + 4}`;
    const cur = byDecade.get(decade) ?? { hit: 0, total: 0 };
    cur.total++;
    const p = monthlyPeak.get(m);
    if (p !== undefined && p >= thresholdPips) cur.hit++;
    byDecade.set(decade, cur);
  }
  for (const [k, v] of [...byDecade].sort()) {
    console.log(`  ${k}: ${v.hit}/${v.total} (${(v.hit / v.total * 100).toFixed(1)}%)`);
  }

  // 上位 10
  console.log('\n上位 10 月（ピーク pips 順）:');
  hits.sort((a, b) => b.peak - a.peak);
  console.log('Month   | Peak pips');
  console.log('--------|----------');
  for (const h of hits.slice(0, 10)) {
    console.log(`${h.month} | ${h.peak.toFixed(1).padStart(8)}`);
  }

  // ヒストグラム
  console.log('\n月内ピーク pips 分布（50 pips 刻み）:');
  const sortedBuckets = [...histogram.keys()].sort((a, b) => a - b);
  for (const b of sortedBuckets) {
    const count = histogram.get(b)!;
    const bar = '#'.repeat(Math.max(1, Math.ceil(count / 3)));
    const label = `${b}+`;
    console.log(`  ${label.padStart(5)} pips: ${String(count).padStart(3)} 月 ${bar}`);
  }
}

main();
