/**
 * SMA 乖離度フィルター（方向別）の sweep スクリプト
 *
 * 既存ベースラインに `maxDirectionalDivergencePct` を 0 / 0.1 / 0.2 / 0.3 / 0.5 で掛けて比較する。
 * BUY は price > SMA20 + N%、SELL は price < SMA20 - N% のときブロック（非対称）。
 *
 * Usage: npx tsx scripts/run-bt-divergence-sweep.ts
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
import type { SmaCrossParameters } from '../src/parameter/ParameterSet.js';

const PAIR = CurrencyPair('USD_JPY');
const INITIAL = 100_000;

const DIVERGENCE_CANDIDATES: Array<{ pct: number; label: string }> = [
  { pct: 0,    label: 'ベースライン（フィルター無効）' },
  { pct: 0.1,  label: '0.1%' },
  { pct: 0.2,  label: '0.2%' },
  { pct: 0.3,  label: '0.3%' },
  { pct: 0.5,  label: '0.5%' },
];

function buildParams(maxDivergencePct: number): SmaCrossParameters {
  return {
    strategy: 'SMA_CROSS',
    pair: PAIR,
    timeframe: TimeFrame.FIFTEEN_MINUTE,
    dateFrom: new Date('2006-01-01T00:00:00Z'),
    dateTo: new Date('2026-03-31T00:00:00Z'),
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
    maxDirectionalDivergencePct: maxDivergencePct > 0 ? maxDivergencePct : undefined,
  };
}

function formatEquity(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '億';
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString() + '万';
  return Math.round(n).toLocaleString() + '円';
}

async function main() {
  console.log('=== SMA 乖離度フィルター（方向別）sweep ===');
  console.log('BUY: price > SMA20 + N% でブロック / SELL: price < SMA20 - N% でブロック');
  console.log(`候補: ${DIVERGENCE_CANDIDATES.map(c => c.label).join(' / ')}\n`);

  const dbConfig = loadTimescaleDbConfigFromEnv();

  const dataProvider = TimescaleDataProvider.fromConfig(dbConfig);
  const resultPool = new Pool(dbConfig);
  const resultStore = new PostgresResultStore(resultPool);
  const batchStore = new PostgresBatchStore(resultPool);
  const smaFactory = new BacktestSmaCalculatorFactory();

  const runner = new BacktestRunner(
    resultStore,
    batchStore,
    () => dataProvider,
    smaFactory,
    EngineMode.OHLC,
    { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 },
    INITIAL,
    'feat/margin-based-lot-policy',
  );

  const batchId = randomUUID();
  const description = 'SMA 乖離度フィルター（方向別） sweep: 0/0.1/0.2/0.3/0.5%';
  const paramsList = DIVERGENCE_CANDIDATES.map(c => buildParams(c.pct));

  console.log('sweep 実行中...');
  const startTime = Date.now();

  try {
    const results = await runner.run(paramsList, batchId, description);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`完了 (${elapsed}s)\n`);

    console.log('=== 結果一覧 ===');
    console.log('候補                          | Trades | Win率  | 総損益pips | PF    | 最大DD   | Sharpe(年率) | 最終 equity');
    console.log('------------------------------|--------|--------|------------|-------|----------|--------------|--------------');
    results.forEach((r, i) => {
      const c = DIVERGENCE_CANDIDATES[i]!;
      const last = r.trades.at(-1);
      const equity = last?.equityAfter ?? INITIAL;
      console.log(
        `${c.label.padEnd(30)} | ${String(r.tradeCount).padStart(6)} | ${(r.winRate * 100).toFixed(1).padStart(5)}% | ${r.totalPnl.toFixed(1).padStart(10)} | ${r.profitFactor.toFixed(2).padStart(5)} | ${r.maxDrawdown.toFixed(1).padStart(8)} | ${r.annualizedSharpeRatio.toFixed(2).padStart(12)} | ${formatEquity(equity).padStart(12)}`,
      );
    });

    console.log('\n=== DB 保存確認 ===');
    console.log(`batchId: ${batchId}`);
    console.log(`クエリ例: SELECT * FROM backtest.bt_runs WHERE batch_id = '${batchId}';`);
  } finally {
    await closeBacktestResources(dataProvider, resultPool);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
