/**
 * Out-of-Sample (OOS) 検証スクリプト
 *
 * 目的: 現在採用しているフィルターと 0.1% 乖離フィルターが
 *   data-snooping でなく本当に効いているかを、未見データで検証する。
 *
 * 分割:
 *   - IS（学習用, In-Sample）     : 2006-01-01 〜 2020-12-31（約 15 年）
 *   - OOS（検証用, Out-of-Sample） : 2021-01-01 〜 2026-03-31（約 5 年 3 ヶ月）
 *
 * 比較パターン:
 *   A: 現行採用構成（minCrossStrength 0.1, midMonth, MarginBased 140%）
 *   B: A + 0.1% 乖離フィルター
 *
 * 合計 4 run（A_IS, A_OOS, B_IS, B_OOS）。IS/OOS で PF・勝率・Sharpe(年率)・DD の
 * 劣化具合を並べ、データ依存していないか判断する。
 *
 * Usage: npx tsx scripts/run-bt-oos-validation.ts
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

const IS_FROM = new Date('2006-01-01T00:00:00Z');
const IS_TO = new Date('2021-01-01T00:00:00Z');
const OOS_FROM = new Date('2021-01-01T00:00:00Z');
const OOS_TO = new Date('2026-03-31T00:00:00Z');

interface PatternDef {
  readonly label: string;
  readonly extraDivergencePct: number;
}

const PATTERNS: PatternDef[] = [
  { label: 'A: 現行採用構成',              extraDivergencePct: 0 },
  { label: 'B: A + 0.1% 乖離フィルター',   extraDivergencePct: 0.1 },
];

function buildParams(dateFrom: Date, dateTo: Date, extraDivergencePct: number): SmaCrossParameters {
  return {
    strategy: 'SMA_CROSS',
    pair: PAIR,
    timeframe: TimeFrame.FIFTEEN_MINUTE,
    dateFrom,
    dateTo,
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

function formatEquity(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '億';
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString() + '万';
  return Math.round(n).toLocaleString() + '円';
}

function formatMonths(ms: number): string {
  const months = ms / (30 * 86_400_000);
  return `${months.toFixed(1)}ヶ月`;
}

async function main() {
  console.log('=== OOS 検証 ===');
  console.log(`IS : ${IS_FROM.toISOString().slice(0, 10)} 〜 ${IS_TO.toISOString().slice(0, 10)}`);
  console.log(`OOS: ${OOS_FROM.toISOString().slice(0, 10)} 〜 ${OOS_TO.toISOString().slice(0, 10)}\n`);

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

    // --- IS batch ---
    const isBatchId = randomUUID();
    console.log(`IS batch (${isBatchId}) 実行中...`);
    const isResults = await runner.run(
      PATTERNS.map(p => buildParams(IS_FROM, IS_TO, p.extraDivergencePct)),
      isBatchId,
      'OOS validation / In-Sample',
      { sampleType: SampleType.IN_SAMPLE, foldNumber: null },
    );
    console.log(`完了 (${((Date.now() - startTime) / 1000).toFixed(1)}s)\n`);

    // --- OOS batch ---
    const oosBatchId = randomUUID();
    const oosStart = Date.now();
    console.log(`OOS batch (${oosBatchId}) 実行中...`);
    const oosResults = await runner.run(
      PATTERNS.map(p => buildParams(OOS_FROM, OOS_TO, p.extraDivergencePct)),
      oosBatchId,
      'OOS validation / Out-of-Sample',
      { sampleType: SampleType.OUT_OF_SAMPLE, foldNumber: null },
    );
    console.log(`完了 (${((Date.now() - oosStart) / 1000).toFixed(1)}s)\n`);

    printSummary('IS 結果', isResults);
    printSummary('OOS 結果', oosResults);
    printDelta(isResults, oosResults);

    console.log('\n=== DB 保存確認 ===');
    console.log(`IS  batchId: ${isBatchId}`);
    console.log(`OOS batchId: ${oosBatchId}`);
    console.log(`クエリ例: SELECT sample_type, params->>'maxDirectionalDivergencePct' AS div, profit_factor, annualized_sharpe_ratio, max_drawdown FROM backtest.bt_runs WHERE batch_id IN ('${isBatchId}', '${oosBatchId}') ORDER BY sample_type, div;`);
  } finally {
    await closeBacktestResources(dataProvider, resultPool);
  }
}

function printSummary(title: string, results: ReadonlyArray<BacktestResult>): void {
  console.log(`=== ${title} ===`);
  console.log('パターン                          | Trades | Win率  | 総損益pips | PF    | 最大DD   | DD期間   | Sharpe年率 | 最終 equity');
  console.log('----------------------------------|--------|--------|------------|-------|----------|----------|------------|-------------');
  results.forEach((r, i) => {
    const p = PATTERNS[i]!;
    const last = r.trades.at(-1);
    const equity = last?.equityAfter ?? INITIAL;
    console.log(
      `${p.label.padEnd(34)} | ${String(r.tradeCount).padStart(6)} | ${(r.winRate * 100).toFixed(1).padStart(5)}% | ${r.totalPnl.toFixed(1).padStart(10)} | ${r.profitFactor.toFixed(2).padStart(5)} | ${r.maxDrawdown.toFixed(1).padStart(8)} | ${formatMonths(r.maxDrawdownDurationMs).padStart(8)} | ${r.annualizedSharpeRatio.toFixed(2).padStart(10)} | ${formatEquity(equity).padStart(11)}`,
    );
  });
  console.log();
}

function printDelta(is: ReadonlyArray<BacktestResult>, oos: ReadonlyArray<BacktestResult>): void {
  console.log('=== IS → OOS 劣化率（PF・Sharpe が落ちていないかが真のエッジの判定） ===');
  console.log('パターン                          | PF IS → OOS          | Sharpe年率 IS → OOS    | 最大DD IS → OOS');
  console.log('----------------------------------|----------------------|------------------------|---------------------');
  PATTERNS.forEach((p, i) => {
    const a = is[i]!; const b = oos[i]!;
    const pfDelta = a.profitFactor > 0 ? ((b.profitFactor - a.profitFactor) / a.profitFactor * 100) : 0;
    const shDelta = a.annualizedSharpeRatio !== 0 ? ((b.annualizedSharpeRatio - a.annualizedSharpeRatio) / Math.abs(a.annualizedSharpeRatio) * 100) : 0;
    const ddDelta = a.maxDrawdown > 0 ? ((b.maxDrawdown - a.maxDrawdown) / a.maxDrawdown * 100) : 0;
    console.log(
      `${p.label.padEnd(34)} | ${a.profitFactor.toFixed(2)} → ${b.profitFactor.toFixed(2)} (${pfDelta >= 0 ? '+' : ''}${pfDelta.toFixed(1)}%) | ${a.annualizedSharpeRatio.toFixed(2)} → ${b.annualizedSharpeRatio.toFixed(2)} (${shDelta >= 0 ? '+' : ''}${shDelta.toFixed(1)}%) | ${a.maxDrawdown.toFixed(0)} → ${b.maxDrawdown.toFixed(0)} (${ddDelta >= 0 ? '+' : ''}${ddDelta.toFixed(1)}%)`,
    );
  });
}

main().catch(e => { console.error(e); process.exit(1); });
