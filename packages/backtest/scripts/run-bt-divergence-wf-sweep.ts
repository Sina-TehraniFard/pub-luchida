/**
 * SMA 乖離度フィルターの閾値 × Walk-Forward 検証
 *
 * 目的: 0.1% を Range-focused OOS だけで採用した判定の頑健性を再評価する。
 *   閾値を 5 段階で変え、16 ウィンドウ（年単位）で各指標を計測。
 *
 * 閾値候補: 0（無効）/ 0.05% / 0.10% / 0.15% / 0.20%
 * ウィンドウ: 2011-2026（16 年、2026 は 1-3 月のみ）
 * 合計 run 数: 5 × 16 = 80
 *
 * Usage: npx tsx scripts/run-bt-divergence-wf-sweep.ts
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

interface Window { readonly year: number; readonly from: Date; readonly to: Date; }

function buildWindows(): Window[] {
  const windows: Window[] = [];
  for (let y = 2011; y <= 2025; y++) {
    windows.push({ year: y, from: new Date(`${y}-01-01T00:00:00Z`), to: new Date(`${y + 1}-01-01T00:00:00Z`) });
  }
  windows.push({ year: 2026, from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-04-01T00:00:00Z') });
  return windows;
}

const THRESHOLDS = [
  { label: '0 (なし)', pct: 0 },
  { label: '0.05%',     pct: 0.05 },
  { label: '0.10%',     pct: 0.10 },
  { label: '0.15%',     pct: 0.15 },
  { label: '0.20%',     pct: 0.20 },
] as const;

function buildParams(w: Window, divergencePct: number): SmaCrossParameters {
  return {
    strategy: 'SMA_CROSS', pair: PAIR, timeframe: TimeFrame.FIFTEEN_MINUTE,
    dateFrom: w.from, dateTo: w.to,
    shortPeriod: 20, longPeriod: 100,
    stopLossPips: 40, takeProfitPips: 150,
    trailActivatePips: 150, trailWidthPips: 70,
    excludeHoursUtc: [0, 7, 18], maxHoldBars: 192,
    riskPct: 0.02, targetMaintenanceRatio: 1.40, marginRate: 0.04,
    minCrossStrengthPips: 0.1,
    excludeMidMonthJstLunchNonBoj: true,
    maxDirectionalDivergencePct: divergencePct > 0 ? divergencePct : undefined,
  };
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : (sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
}

async function main() {
  const windows = buildWindows();
  console.log('=== SMA 乖離度 × Walk-Forward 閾値 sweep ===');
  console.log(`ウィンドウ: ${windows.length} 年（${windows[0]!.year}〜${windows.at(-1)!.year}）`);
  console.log(`閾値候補: ${THRESHOLDS.map(t => t.label).join(' / ')}`);
  console.log(`合計 run: ${windows.length * THRESHOLDS.length}\n`);

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
      INITIAL, 'chore/align-bt-baseline-with-production',
    );

    const startTime = Date.now();
    const allResults: { window: Window; results: BacktestResult[] }[] = [];

    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]!;
      const batchId = randomUUID();
      const paramsList = THRESHOLDS.map(t => buildParams(w, t.pct));
      process.stdout.write(`[${String(i + 1).padStart(2)}/${windows.length}] ${w.year}...`);
      const wStart = Date.now();
      const results = await runner.run(
        paramsList, batchId, `WF divergence sweep ${w.year}`,
        { sampleType: SampleType.WALK_FORWARD, foldNumber: i + 1 },
      );
      process.stdout.write(` ${((Date.now() - wStart) / 1000).toFixed(1)}s\n`);
      allResults.push({ window: w, results });
    }

    console.log(`\n全 ${windows.length * THRESHOLDS.length} run 完了 (${((Date.now() - startTime) / 1000).toFixed(1)}s)\n`);

    // === 年別パフォーマンス ===
    console.log('=== 年別 Sharpe 年率（閾値別） ===');
    const header = 'Year | ' + THRESHOLDS.map(t => t.label.padStart(9)).join(' | ');
    console.log(header);
    console.log('-'.repeat(header.length));
    for (const { window: w, results } of allResults) {
      const row = `${w.year} | ` + results.map(r => r.annualizedSharpeRatio.toFixed(2).padStart(9)).join(' | ');
      console.log(row);
    }

    console.log('\n=== 閾値別集計 ===');
    console.log('閾値     | 黒字年数 | 合計 pips | 合計 trades | PF 中央値 | PF 最悪 | Sharpe 平均 | Sharpe 最悪 | DD 最悪');
    console.log('---------|----------|-----------|-------------|-----------|---------|-------------|-------------|--------');
    for (let ti = 0; ti < THRESHOLDS.length; ti++) {
      const t = THRESHOLDS[ti]!;
      const rs = allResults.map(d => d.results[ti]!);
      const totalPnl = rs.reduce((s, r) => s + r.totalPnl, 0);
      const totalTrades = rs.reduce((s, r) => s + r.tradeCount, 0);
      const profitable = rs.filter(r => r.totalPnl > 0).length;
      const pfs = rs.map(r => r.profitFactor).filter(v => v > 0 && Number.isFinite(v));
      const medPF = median(pfs);
      const minPF = pfs.length > 0 ? Math.min(...pfs) : 0;
      const sharpes = rs.map(r => r.annualizedSharpeRatio).filter(Number.isFinite);
      const avgSharpe = sharpes.reduce((s, v) => s + v, 0) / Math.max(sharpes.length, 1);
      const minSharpe = sharpes.length > 0 ? Math.min(...sharpes) : 0;
      const maxDD = Math.max(...rs.map(r => r.maxDrawdown));
      console.log(
        `${t.label.padEnd(8)} | ${String(profitable).padStart(2)} / ${rs.length} | ${totalPnl.toFixed(0).padStart(9)} | ${String(totalTrades).padStart(11)} | ${medPF.toFixed(2).padStart(9)} | ${minPF.toFixed(2).padStart(7)} | ${avgSharpe.toFixed(2).padStart(11)} | ${minSharpe.toFixed(2).padStart(11)} | ${maxDD.toFixed(0).padStart(6)}`,
      );
    }
  } finally {
    await closeBacktestResources(dataProvider, resultPool);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
