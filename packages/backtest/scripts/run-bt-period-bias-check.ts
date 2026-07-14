/**
 * 期間バイアス検証（OOS 改善が本物か期間の運かを判定）
 *
 * 前回 run-bt-oos-validation.ts では IS 2006-2021（荒れ相場）/ OOS 2021-2026（円安トレンド）
 * という分割で「IS → OOS で改善」が出た。SMA クロスは順張り型なので、トレンド強い OOS は
 * 構造的に有利。これが「戦略のエッジ」か「期間の運」かを判定するため、3 通りの追加検証を行う。
 *
 * 検証 1: Reverse split
 *   IS  = 2021-2026 (5 年、円安トレンド)
 *   OOS = 2006-2021 (15 年、金融危機・超円高・レンジ混在)
 *   → トレンドで決めたパラメータが荒れ相場で崩れないか
 *
 * 検証 2: Range-focused OOS
 *   IS  = 2006-2014 (9 年、古い期間)
 *   OOS = 2015-2019 (5 年、レンジ・狭幅相場が多い)
 *   → SMA クロスに最も不利な環境で B が A を上回るか
 *
 * 検証 3: 既存 WF 結果からレンジ年（2015, 2019）を抽出して再集計
 *   2015, 2019 は USDJPY が 8〜10 円幅の狭レンジで SMA クロスが機能しにくい年
 *   → ここで B/A の優位性が維持されているか
 *
 * Usage: npx tsx scripts/run-bt-period-bias-check.ts
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import { TimescaleDataProvider } from '../src/data-provider/TimescaleDataProvider.js';
import { loadTimescaleDbConfigFromEnv } from '../src/data-provider/TimescaleDbConfig.js';
import { PostgresResultStore } from '../src/result/PostgresResultStore.js';
import { PostgresBatchStore } from '../src/result/PostgresBatchStore.js';
import { BacktestRunner } from '../src/runner/Runner.js';
import { BacktestSmaCalculatorFactory } from '../src/snapshot-adapter/BacktestSmaCalculatorFactory.js';
import { closeBacktestResources } from './closeBacktestResources.js';
import { EngineMode } from '../src/engine/EngineConfig.js';
import { SampleType } from '../src/result/BacktestResult.js';
import type { SmaCrossParameters } from '../src/parameter/ParameterSet.js';
import type { BacktestResult } from '../src/result/BacktestResult.js';

const PAIR = CurrencyPair('USD_JPY');
const INITIAL = 100_000;

interface PatternDef {
  readonly label: string;
  readonly extraDivergencePct: number;
}

const PATTERNS: PatternDef[] = [
  { label: 'A: 現行採用',         extraDivergencePct: 0 },
  { label: 'B: A + 0.1% 乖離',     extraDivergencePct: 0.1 },
];

function buildParams(dateFrom: Date, dateTo: Date, extraDivergencePct: number): SmaCrossParameters {
  return {
    strategy: 'SMA_CROSS', pair: PAIR, timeframe: TimeFrame.FIFTEEN_MINUTE,
    dateFrom, dateTo,
    shortPeriod: 20, longPeriod: 100,
    stopLossPips: 40, takeProfitPips: 150,
    trailActivatePips: 150, trailWidthPips: 70,
    excludeHoursUtc: [0, 7, 18], maxHoldBars: 192,
    riskPct: 0.02, targetMaintenanceRatio: 1.40, marginRate: 0.04,
    minCrossStrengthPips: 0.1, excludeMidMonthJstLunchNonBoj: true,
    maxDirectionalDivergencePct: extraDivergencePct > 0 ? extraDivergencePct : undefined,
  };
}

function fmtEq(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '億';
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString() + '万';
  return Math.round(n).toLocaleString() + '円';
}

interface SplitDef {
  readonly label: string;
  readonly is: { from: Date; to: Date };
  readonly oos: { from: Date; to: Date };
}

const SPLITS: SplitDef[] = [
  {
    label: '検証1: Reverse split',
    is:  { from: new Date('2021-01-01T00:00:00Z'), to: new Date('2026-04-01T00:00:00Z') },
    oos: { from: new Date('2006-01-01T00:00:00Z'), to: new Date('2021-01-01T00:00:00Z') },
  },
  {
    label: '検証2: Range-focused OOS',
    is:  { from: new Date('2006-01-01T00:00:00Z'), to: new Date('2015-01-01T00:00:00Z') },
    oos: { from: new Date('2015-01-01T00:00:00Z'), to: new Date('2020-01-01T00:00:00Z') },
  },
];

async function main() {
  console.log('=== 期間バイアス検証（OOS 改善が本物か期間の運かを判定）===\n');

  const dbConfig = loadTimescaleDbConfigFromEnv();

  const dataProvider = TimescaleDataProvider.fromConfig(dbConfig);
  const resultPool = new Pool(dbConfig);
  const resultStore = new PostgresResultStore(resultPool);
  const batchStore = new PostgresBatchStore(resultPool);
  const smaFactory = new BacktestSmaCalculatorFactory();

  try {
    const runner = new BacktestRunner(
      resultStore, batchStore, () => dataProvider, smaFactory,
      EngineMode.OHLC,
      { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 },
      INITIAL, 'feat/margin-based-lot-policy',
    );

    for (const split of SPLITS) {
      console.log(`\n--- ${split.label} ---`);
      console.log(`IS : ${split.is.from.toISOString().slice(0, 10)} 〜 ${split.is.to.toISOString().slice(0, 10)}`);
      console.log(`OOS: ${split.oos.from.toISOString().slice(0, 10)} 〜 ${split.oos.to.toISOString().slice(0, 10)}`);

      // IS batch
      const isBatch = randomUUID();
      const tStart = Date.now();
      process.stdout.write(`  IS  実行中...`);
      const isResults = await runner.run(
        PATTERNS.map(p => buildParams(split.is.from, split.is.to, p.extraDivergencePct)),
        isBatch, `${split.label} / In-Sample`,
        { sampleType: SampleType.IN_SAMPLE, foldNumber: null },
      );
      process.stdout.write(` (${((Date.now() - tStart) / 1000).toFixed(1)}s)\n`);

      // OOS batch
      const oosBatch = randomUUID();
      const tOos = Date.now();
      process.stdout.write(`  OOS 実行中...`);
      const oosResults = await runner.run(
        PATTERNS.map(p => buildParams(split.oos.from, split.oos.to, p.extraDivergencePct)),
        oosBatch, `${split.label} / Out-of-Sample`,
        { sampleType: SampleType.OUT_OF_SAMPLE, foldNumber: null },
      );
      process.stdout.write(` (${((Date.now() - tOos) / 1000).toFixed(1)}s)\n`);

      printSplitResults(split, isResults, oosResults);
    }

    // 検証 3: 既存 WF 結果からレンジ年を抽出して B/A 優位性を再集計
    console.log('\n--- 検証3: 既存 WF 結果からレンジ年（2015, 2019）抽出 ---');
    await analyzeWfRangeYears(resultPool);
  } finally {
    await closeBacktestResources(dataProvider, resultPool);
  }
  console.log('\n=== 検証完了 ===');
}

function printSplitResults(
  split: SplitDef,
  isR: ReadonlyArray<BacktestResult>,
  oosR: ReadonlyArray<BacktestResult>,
): void {
  console.log(`\n  [IS  結果]`);
  printRows(isR);
  console.log(`\n  [OOS 結果]`);
  printRows(oosR);
  console.log(`\n  [IS → OOS 劣化率]`);
  console.log('  パターン          | PF IS → OOS         | Sharpe年率 IS → OOS    | DD IS → OOS');
  console.log('  ------------------|---------------------|------------------------|---------------------');
  PATTERNS.forEach((p, i) => {
    const a = isR[i]!; const b = oosR[i]!;
    const pf = a.profitFactor > 0 ? ((b.profitFactor - a.profitFactor) / a.profitFactor * 100) : 0;
    const sh = a.annualizedSharpeRatio !== 0 ? ((b.annualizedSharpeRatio - a.annualizedSharpeRatio) / Math.abs(a.annualizedSharpeRatio) * 100) : 0;
    const dd = a.maxDrawdown > 0 ? ((b.maxDrawdown - a.maxDrawdown) / a.maxDrawdown * 100) : 0;
    console.log(
      `  ${p.label.padEnd(18)} | ${a.profitFactor.toFixed(2)} → ${b.profitFactor.toFixed(2)} (${pf >= 0 ? '+' : ''}${pf.toFixed(1)}%) | ${a.annualizedSharpeRatio.toFixed(2)} → ${b.annualizedSharpeRatio.toFixed(2)} (${sh >= 0 ? '+' : ''}${sh.toFixed(1)}%) | ${a.maxDrawdown.toFixed(0)} → ${b.maxDrawdown.toFixed(0)} (${dd >= 0 ? '+' : ''}${dd.toFixed(1)}%)`,
    );
  });
}

function printRows(results: ReadonlyArray<BacktestResult>): void {
  console.log('  パターン          | Trades | Win率 | 総pips  | PF   | DD    | Sharpe年率 | 最終eq');
  console.log('  ------------------|--------|-------|---------|------|-------|------------|--------');
  results.forEach((r, i) => {
    const p = PATTERNS[i]!;
    const eq = r.trades.at(-1)?.equityAfter ?? INITIAL;
    console.log(
      `  ${p.label.padEnd(18)} | ${String(r.tradeCount).padStart(6)} | ${(r.winRate * 100).toFixed(1).padStart(4)}% | ${r.totalPnl.toFixed(0).padStart(7)} | ${r.profitFactor.toFixed(2).padStart(4)} | ${r.maxDrawdown.toFixed(0).padStart(5)} | ${r.annualizedSharpeRatio.toFixed(2).padStart(10)} | ${fmtEq(eq).padStart(7)}`,
    );
  });
}

async function analyzeWfRangeYears(pool: Pool): Promise<void> {
  const RANGE_YEARS = [2015, 2019];
  const TREND_YEARS = [2013, 2014, 2022, 2024];
  console.log(`  レンジ年: ${RANGE_YEARS.join(', ')} / 比較用トレンド年: ${TREND_YEARS.join(', ')}`);

  const sql = `
    SELECT
      EXTRACT(YEAR FROM date_from)::int AS year,
      params->>'maxDirectionalDivergencePct' AS divergence,
      profit_factor::float, max_drawdown::float, annualized_sharpe_ratio::float,
      total_pnl::float, trade_count
    FROM backtest.bt_runs
    WHERE sample_type = 'WALK_FORWARD'
      AND EXTRACT(YEAR FROM date_from) = ANY($1::int[])
    ORDER BY year, divergence NULLS FIRST
  `;
  const allYears = [...RANGE_YEARS, ...TREND_YEARS];
  const { rows } = await pool.query(sql, [allYears]);

  if (rows.length === 0) {
    console.log('  WF 結果が見つからない（先に run-bt-walk-forward.ts を実行してください）');
    return;
  }

  // 年×パターンの集計
  const grouped = new Map<number, { a?: typeof rows[0]; b?: typeof rows[0] }>();
  for (const r of rows) {
    const y = r.year;
    if (!grouped.has(y)) grouped.set(y, {});
    const entry = grouped.get(y)!;
    if (r.divergence == null) entry.a = r;
    else entry.b = r;
  }

  console.log('\n  Year | Type    | A: PF | A: Sharpe | A: DD  | B: PF | B: Sharpe | B: DD  | B 優位 (PF/Sharpe/DD)');
  console.log('  -----|---------|-------|-----------|--------|-------|-----------|--------|----------------------');
  let bWinsRange = 0; let totalRange = 0;
  let bWinsTrend = 0; let totalTrend = 0;

  for (const y of allYears) {
    const entry = grouped.get(y);
    if (!entry?.a || !entry?.b) continue;
    const isRange = RANGE_YEARS.includes(y);
    const type = isRange ? 'RANGE' : 'TREND';
    const pfWin = entry.b.profit_factor > entry.a.profit_factor;
    const shWin = entry.b.annualized_sharpe_ratio > entry.a.annualized_sharpe_ratio;
    const ddWin = entry.b.max_drawdown < entry.a.max_drawdown;
    const advCount = (pfWin ? 1 : 0) + (shWin ? 1 : 0) + (ddWin ? 1 : 0);
    const advStr = `${pfWin ? '○' : '×'}/${shWin ? '○' : '×'}/${ddWin ? '○' : '×'}`;
    if (isRange) { totalRange++; if (advCount >= 2) bWinsRange++; }
    else         { totalTrend++; if (advCount >= 2) bWinsTrend++; }
    console.log(
      `  ${y} | ${type.padEnd(7)} | ${entry.a.profit_factor.toFixed(2)}  | ${entry.a.annualized_sharpe_ratio.toFixed(2).padStart(9)} | ${entry.a.max_drawdown.toFixed(0).padStart(6)} | ${entry.b.profit_factor.toFixed(2)}  | ${entry.b.annualized_sharpe_ratio.toFixed(2).padStart(9)} | ${entry.b.max_drawdown.toFixed(0).padStart(6)} | ${advStr}`,
    );
  }
  console.log(`\n  レンジ年で B が A に優位（3 指標中 2+ 勝）: ${bWinsRange}/${totalRange}`);
  console.log(`  トレンド年で B が A に優位（3 指標中 2+ 勝）: ${bWinsTrend}/${totalTrend}`);
  if (bWinsRange === totalRange) {
    console.log('  → レンジ年でも B が一貫して優位 = エッジは期間の運ではない');
  } else if (bWinsRange >= totalRange / 2) {
    console.log('  → レンジ年で B が過半数優位 = エッジは概ね本物');
  } else {
    console.log('  → レンジ年で B が劣位多数 = フィルターはトレンド相場でのみ有効な可能性');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
