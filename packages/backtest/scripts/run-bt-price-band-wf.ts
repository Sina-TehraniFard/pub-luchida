/**
 * 価格帯フィルター SELL≥85 の Walk-Forward 16 年検証
 *
 * 2011-2025 の 15 年 + 2026 Q1 = 16 ウィンドウで
 * baseline vs SELL≥85円 の年次性能を比較。
 *
 * 目的: 2009-2012 や他の少ケース期間以外でも悪化しないことを確認し、
 *       頑健性（time-robustness）を示す。
 *
 * Usage: npx tsx scripts/run-bt-price-band-wf.ts
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
const SELL_FLOOR = 85;

interface Window {
  readonly year: number;
  readonly from: Date;
  readonly to: Date;
}

function buildWindows(): Window[] {
  const windows: Window[] = [];
  for (let y = 2011; y <= 2025; y++) {
    windows.push({ year: y, from: new Date(`${y}-01-01T00:00:00Z`), to: new Date(`${y + 1}-01-01T00:00:00Z`) });
  }
  windows.push({ year: 2026, from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-04-01T00:00:00Z') });
  return windows;
}

const PATTERNS = [
  { label: 'A: baseline', minSellPrice: undefined },
  { label: `B: SELL≥${SELL_FLOOR}円`, minSellPrice: SELL_FLOOR },
] as const;

function buildParams(w: Window, minSellPrice?: number): SmaCrossParameters {
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
    maxDirectionalDivergencePct: 0.1,
    ...(minSellPrice != null ? { priceBandFilter: { minSellPrice } } : {}),
  };
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : (sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
}

async function main(): Promise<void> {
  const windows = buildWindows();
  console.log(`=== 価格帯フィルター SELL≥${SELL_FLOOR}円 × Walk-Forward 16 年検証 ===`);
  console.log(`ウィンドウ: ${windows.length} 年 / パターン: ${PATTERNS.length} / 合計 run: ${windows.length * PATTERNS.length}\n`);

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
      INITIAL, 'feat/position-manager-dynamic-lot',
    );

    const startTime = Date.now();
    const allResults: { window: Window; results: BacktestResult[] }[] = [];

    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]!;
      const batchId = randomUUID();
      const paramsList = PATTERNS.map(p => buildParams(w, p.minSellPrice));
      const foldNumber = i + 1;
      process.stdout.write(`[${String(foldNumber).padStart(2)}/${windows.length}] ${w.year}...`);
      const tStart = Date.now();
      const results = await runner.run(
        paramsList, batchId, `WF PriceBand SELL≥${SELL_FLOOR} ${w.year}`,
        { sampleType: SampleType.WALK_FORWARD, foldNumber },
      );
      process.stdout.write(` ${((Date.now() - tStart) / 1000).toFixed(1)}s\n`);
      allResults.push({ window: w, results });
    }

    console.log(`\n完了 (${((Date.now() - startTime) / 1000).toFixed(1)}s)\n`);

    console.log('Year | Pattern          | Trades | 勝率 | 総pips | PF   | DD  | Sharpe年率');
    console.log('-----|------------------|--------|------|--------|------|-----|-----------');
    for (const { window: w, results } of allResults) {
      results.forEach((r, i) => {
        const p = PATTERNS[i]!;
        console.log(
          `${w.year} | ${p.label.padEnd(16)} | ${String(r.tradeCount).padStart(6)} | ${(r.winRate * 100).toFixed(1).padStart(3)}% | ${r.totalPnl.toFixed(0).padStart(6)} | ${r.profitFactor.toFixed(2).padStart(4)} | ${r.maxDrawdown.toFixed(0).padStart(3)} | ${r.annualizedSharpeRatio.toFixed(2).padStart(9)}`,
        );
      });
    }

    console.log('\n=== パターン別集計 ===');
    for (let p = 0; p < PATTERNS.length; p++) {
      const pattern = PATTERNS[p]!;
      const rs = allResults.map(d => d.results[p]!);
      const totalPnl = rs.reduce((s, r) => s + r.totalPnl, 0);
      const profitable = rs.filter(r => r.totalPnl > 0).length;
      const pfs = rs.map(r => r.profitFactor).filter(v => v > 0 && Number.isFinite(v));
      const sharpes = rs.map(r => r.annualizedSharpeRatio).filter(Number.isFinite);
      const avgSharpe = sharpes.reduce((s, v) => s + v, 0) / Math.max(sharpes.length, 1);
      const minSharpe = sharpes.length > 0 ? Math.min(...sharpes) : 0;
      const maxDD = Math.max(...rs.map(r => r.maxDrawdown));
      console.log(`--- ${pattern.label} ---`);
      console.log(`  黒字年数:         ${profitable}/${rs.length} (${(profitable / rs.length * 100).toFixed(0)}%)`);
      console.log(`  合計 pips:        ${totalPnl.toFixed(0)}`);
      console.log(`  PF 中央値:        ${median(pfs).toFixed(2)}`);
      console.log(`  PF 最悪:          ${pfs.length > 0 ? Math.min(...pfs).toFixed(2) : 'N/A'}`);
      console.log(`  Sharpe 年率 平均: ${avgSharpe.toFixed(2)}`);
      console.log(`  Sharpe 最悪年:    ${minSharpe.toFixed(2)}`);
      console.log(`  DD 最悪年:        ${maxDD.toFixed(0)} pips`);
      console.log('');
    }

    console.log('=== SELL≥85 vs baseline の年次差分 ===');
    console.log('Year | 総pips差  | Sharpe差  |');
    console.log('-----|-----------|-----------|');
    for (const { window: w, results } of allResults) {
      const [a, b] = results;
      const pipsDiff = b!.totalPnl - a!.totalPnl;
      const sharpeDiff = b!.annualizedSharpeRatio - a!.annualizedSharpeRatio;
      const sign = pipsDiff > 0 ? '🟢' : pipsDiff < 0 ? '🔴' : '➖';
      console.log(`${w.year} | ${(pipsDiff >= 0 ? '+' : '') + pipsDiff.toFixed(0).padStart(8)} | ${(sharpeDiff >= 0 ? '+' : '') + sharpeDiff.toFixed(2).padStart(7)} | ${sign}`);
    }
  } finally {
    await closeBacktestResources(dataProvider, resultPool);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
