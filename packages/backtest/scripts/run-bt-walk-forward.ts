/**
 * Walk-Forward 検証スクリプト
 *
 * 目的: 採用フィルター構成が各時代で安定してエッジを維持できるか検証する。
 *   単発 OOS と異なり、毎年テスト区間をずらすことで時代依存（特定相場環境だけで効く）を
 *   検出する。
 *
 * 今回はパラメータ再最適化は行わない（固定パラメータの時代ロバスト性評価）。
 *
 * 分割:
 *   - テスト区間: 2011-01 〜 2026-03（1 年ずつ、15 ウィンドウ）
 *   - 各テスト区間で 2 パターンを流す（A: 現行採用構成、B: A + 0.1% 乖離）
 *   - warmup はエンジン側で config.warmupCount から処理されるため、テスト区間直前のデータで自動埋め
 *
 * 合計 30 run（15 年 × 2 パターン）。
 *
 * Usage: npx tsx scripts/run-bt-walk-forward.ts
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

interface Window {
  readonly year: number;
  readonly from: Date;
  readonly to: Date;
}

function buildWindows(): Window[] {
  const windows: Window[] = [];
  for (let y = 2011; y <= 2025; y++) {
    windows.push({
      year: y,
      from: new Date(`${y}-01-01T00:00:00Z`),
      to: new Date(`${y + 1}-01-01T00:00:00Z`),
    });
  }
  // 2026 は 3 ヶ月分のみ
  windows.push({
    year: 2026,
    from: new Date('2026-01-01T00:00:00Z'),
    to: new Date('2026-04-01T00:00:00Z'),
  });
  return windows;
}

interface PatternDef {
  readonly label: string;
  readonly extraDivergencePct: number;
}

const PATTERNS: PatternDef[] = [
  { label: 'A: 採用',             extraDivergencePct: 0 },
  { label: 'B: A + 0.1%乖離',     extraDivergencePct: 0.1 },
];

function buildParams(w: Window, extraDivergencePct: number): SmaCrossParameters {
  return {
    strategy: 'SMA_CROSS',
    pair: PAIR,
    timeframe: TimeFrame.FIFTEEN_MINUTE,
    dateFrom: w.from,
    dateTo: w.to,
    shortPeriod: 20,
    longPeriod: 100,
    stopLossPips: 40,
    takeProfitPips: 150,
    trailActivatePips: 150,
    trailWidthPips: 70,
    excludeHoursUtc: [0, 7, 18],
    maxHoldBars: 192,
    riskPct: 0.02,
    targetMaintenanceRatio: 1.40,
    marginRate: 0.04,
    minCrossStrengthPips: 0.1,
    excludeMidMonthJstLunchNonBoj: true,
    maxDirectionalDivergencePct: extraDivergencePct > 0 ? extraDivergencePct : undefined,
  };
}

async function main() {
  const windows = buildWindows();
  console.log('=== Walk-Forward 検証 ===');
  console.log(`ウィンドウ数: ${windows.length} 年（${windows[0]!.year}〜${windows.at(-1)!.year}）`);
  console.log(`パターン数: ${PATTERNS.length}`);
  console.log(`合計 run 数: ${windows.length * PATTERNS.length}\n`);

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

    const startTime = Date.now();
    const allResults: { window: Window; results: BacktestResult[] }[] = [];

    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]!;
      const batchId = randomUUID();
      const description = `Walk-Forward ${w.year}`;
      const paramsList = PATTERNS.map(p => buildParams(w, p.extraDivergencePct));
      const foldNumber = i + 1;

      process.stdout.write(`[${String(foldNumber).padStart(2)}/${windows.length}] ${w.year} ...`);
      const wStart = Date.now();
      const results = await runner.run(
        paramsList, batchId, description,
        { sampleType: SampleType.WALK_FORWARD, foldNumber },
      );
      process.stdout.write(` 完了 (${((Date.now() - wStart) / 1000).toFixed(1)}s)\n`);
      allResults.push({ window: w, results });
    }

    console.log(`\n全ウィンドウ完了 (${((Date.now() - startTime) / 1000).toFixed(1)}s)\n`);

    printYearByYear(allResults);
    printPatternSummary(allResults);
  } finally {
    await closeBacktestResources(dataProvider, resultPool);
  }
}

function printYearByYear(data: ReadonlyArray<{ window: Window; results: BacktestResult[] }>): void {
  console.log('=== 年別パフォーマンス ===');
  console.log('Year | Pattern          | Trades | Win率 | 総pips  | PF   | 最大DD | Sharpe年率');
  console.log('-----|------------------|--------|-------|---------|------|--------|-----------');
  for (const { window: w, results } of data) {
    results.forEach((r, i) => {
      const p = PATTERNS[i]!;
      console.log(
        `${w.year} | ${p.label.padEnd(16)} | ${String(r.tradeCount).padStart(6)} | ${(r.winRate * 100).toFixed(1).padStart(4)}% | ${r.totalPnl.toFixed(0).padStart(7)} | ${r.profitFactor.toFixed(2).padStart(4)} | ${r.maxDrawdown.toFixed(0).padStart(6)} | ${r.annualizedSharpeRatio.toFixed(2).padStart(9)}`,
      );
    });
  }
  console.log();
}

function printPatternSummary(data: ReadonlyArray<{ window: Window; results: BacktestResult[] }>): void {
  console.log('=== パターン別集計（15 ウィンドウの安定性）===');
  for (let p = 0; p < PATTERNS.length; p++) {
    const pattern = PATTERNS[p]!;
    const rs = data.map(d => d.results[p]!);
    const totalPnl = rs.reduce((s, r) => s + r.totalPnl, 0);
    const totalTrades = rs.reduce((s, r) => s + r.tradeCount, 0);
    const profitableYears = rs.filter(r => r.totalPnl > 0).length;
    const pfs = rs.map(r => r.profitFactor).filter(v => v > 0 && Number.isFinite(v));
    const medianPF = pfs.length > 0 ? median(pfs) : 0;
    const minPF = Math.min(...pfs);
    const sharpes = rs.map(r => r.annualizedSharpeRatio).filter(v => Number.isFinite(v));
    const avgSharpe = sharpes.reduce((s, v) => s + v, 0) / Math.max(sharpes.length, 1);
    const worstDD = Math.max(...rs.map(r => r.maxDrawdown));
    console.log(`--- ${pattern.label} ---`);
    console.log(`  黒字の年数:        ${profitableYears} / ${rs.length}（${(profitableYears / rs.length * 100).toFixed(0)}%）`);
    console.log(`  全ウィンドウ合計 pips: ${totalPnl.toFixed(1)}`);
    console.log(`  全ウィンドウ合計 trades: ${totalTrades}`);
    console.log(`  PF 中央値:         ${medianPF.toFixed(2)}`);
    console.log(`  PF 最悪年:         ${minPF.toFixed(2)}`);
    console.log(`  Sharpe年率 平均:   ${avgSharpe.toFixed(2)}`);
    console.log(`  最大 DD（最悪年）: ${worstDD.toFixed(1)} pips`);
    console.log();
  }
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

main().catch(e => { console.error(e); process.exit(1); });
