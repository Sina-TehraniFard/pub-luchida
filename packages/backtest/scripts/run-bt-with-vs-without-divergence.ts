/**
 * 現状の run-bt.ts ベースライン（SMA 乖離なし）vs 乖離 0.1% 追加の比較
 *
 * 他条件は全て同一。
 *   MarginBased 140% + クロス強度 0.1 + 月中 JST 昼 + excludeHoursUtc [0,7,18]
 * 差分: maxDirectionalDivergencePct の有無のみ
 *
 * Usage: npx tsx scripts/run-bt-with-vs-without-divergence.ts
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

const BASE: Omit<SmaCrossParameters, 'maxDirectionalDivergencePct'> = {
  strategy: 'SMA_CROSS', pair: PAIR, timeframe: TimeFrame.FIFTEEN_MINUTE,
  dateFrom: new Date('2006-01-01T00:00:00Z'),
  dateTo: new Date('2026-03-31T00:00:00Z'),
  shortPeriod: 20, longPeriod: 100,
  stopLossPips: 40, takeProfitPips: 150,
  trailActivatePips: 150, trailWidthPips: 70,
  excludeHoursUtc: [0, 7, 18], maxHoldBars: 192,
  riskPct: 0.02, targetMaintenanceRatio: 1.40, marginRate: 0.04,
  minCrossStrengthPips: 0.1,
  excludeMidMonthJstLunchNonBoj: true,
};

const CANDIDATES: SmaCrossParameters[] = [
  BASE,                                         // 現状の run-bt.ts 相当（div なし）
  { ...BASE, maxDirectionalDivergencePct: 0.1 }, // 正しい Phase 3 最終（div 0.1%）
];
const LABELS = ['現状 run-bt.ts（SMA乖離なし）', '修正案（SMA乖離 0.1% 追加）'];

async function main() {
  console.log('=== run-bt.ts 現状 vs SMA乖離 0.1% 追加 ===\n');
  const dbConfig = loadTimescaleDbConfigFromEnv();
  const dataProvider = TimescaleDataProvider.fromConfig(dbConfig);
  const resultPool = new Pool(dbConfig);
  const resultStore = new PostgresResultStore(resultPool);
  const batchStore = new PostgresBatchStore(resultPool);
  const smaFactory = new BacktestSmaCalculatorFactory();
  const runner = new BacktestRunner(
    resultStore, batchStore, () => dataProvider, smaFactory,
    EngineMode.OHLC,
    { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 },
    INITIAL, 'chore/align-bt-baseline',
  );
  const batchId = randomUUID();
  const startTime = Date.now();
  try {
    const results = await runner.run(CANDIDATES, batchId, 'run-bt.ts 反映もれ検証');
    console.log(`完了 (${((Date.now() - startTime) / 1000).toFixed(1)}s)\n`);
    console.log('候補                              | Trades | Win率 | 総pips  | PF   | DD    | Sharpe年率');
    console.log('----------------------------------|--------|-------|---------|------|-------|------------');
    results.forEach((r, i) => {
      console.log(
        `${LABELS[i]!.padEnd(34)} | ${String(r.tradeCount).padStart(6)} | ${(r.winRate * 100).toFixed(1).padStart(4)}% | ${r.totalPnl.toFixed(0).padStart(7)} | ${r.profitFactor.toFixed(2).padStart(4)} | ${r.maxDrawdown.toFixed(0).padStart(5)} | ${r.annualizedSharpeRatio.toFixed(2).padStart(10)}`,
      );
    });
    console.log(`\nbatchId: ${batchId}`);
  } finally {
    await closeBacktestResources(dataProvider, resultPool);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
