/**
 * ベースライン vs Phase 3 最終 の比較 sweep
 *
 * - ベースライン: RiskBased 2% Lot、フィルタ一切なし
 * - Phase 3 最終: MarginBased 140% + クロス強度 0.1 + 月中 JST 昼 + SMA 乖離 0.1%
 *
 * 他条件は全て同一（2006-2026 USD/JPY 15分足、SMA(20/100)、SL 40 / Trail 150-70 / 48h、excludeHoursUtc 同一）
 *
 * Usage: npx tsx scripts/run-bt-baseline-vs-phase3.ts
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

const CANDIDATES: SmaCrossParameters[] = [
  // 真のベースライン: RiskBased 2%、フィルタ一切なし
  {
    strategy: 'SMA_CROSS', pair: PAIR, timeframe: TimeFrame.FIFTEEN_MINUTE,
    dateFrom: new Date('2006-01-01T00:00:00Z'),
    dateTo: new Date('2026-03-31T00:00:00Z'),
    shortPeriod: 20, longPeriod: 100,
    stopLossPips: 40, takeProfitPips: 150,
    trailActivatePips: 150, trailWidthPips: 70,
    excludeHoursUtc: [],  // 時間帯除外なし
    maxHoldBars: 192,
    riskPct: 0.02,
    // targetMaintenanceRatio 指定なし → RiskBased 2%
  },
  // Phase 3 最終: 採用 4 フィルター全適用
  {
    strategy: 'SMA_CROSS', pair: PAIR, timeframe: TimeFrame.FIFTEEN_MINUTE,
    dateFrom: new Date('2006-01-01T00:00:00Z'),
    dateTo: new Date('2026-03-31T00:00:00Z'),
    shortPeriod: 20, longPeriod: 100,
    stopLossPips: 40, takeProfitPips: 150,
    trailActivatePips: 150, trailWidthPips: 70,
    excludeHoursUtc: [0, 7, 18],  // Phase 3 時間帯除外
    maxHoldBars: 192,
    riskPct: 0.02,
    targetMaintenanceRatio: 1.40,  // MarginBased Lot
    marginRate: 0.04,
    minCrossStrengthPips: 0.1,
    excludeMidMonthJstLunchNonBoj: true,
    maxDirectionalDivergencePct: 0.1,
  },
];

const LABELS = ['ベースライン（フィルタなし・RiskBased 2%）', 'Phase 3 最終（全 4 フィルター + MarginBased 140%）'];

function fmtEq(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '億';
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString() + '万';
  return Math.round(n).toLocaleString() + '円';
}

async function main() {
  console.log('=== ベースライン vs Phase 3 最終 比較 sweep ===\n');

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
    INITIAL, 'bt-phase3/main',
  );

  const batchId = randomUUID();
  console.log('sweep 実行中...');
  const startTime = Date.now();

  try {
    const results = await runner.run(CANDIDATES, batchId, 'ベースライン vs Phase 3');
    console.log(`完了 (${((Date.now() - startTime) / 1000).toFixed(1)}s)\n`);

    console.log('=== 結果 ===');
    console.log('候補                                              | Trades | Win率 | 総pips  | PF   | 最大DD | Sharpe年率 | Sortino年率 | 最終 equity');
    console.log('--------------------------------------------------|--------|-------|---------|------|--------|------------|-------------|-------------');
    results.forEach((r, i) => {
      const eq = r.trades.at(-1)?.equityAfter ?? INITIAL;
      console.log(
        `${LABELS[i]!.padEnd(50)} | ${String(r.tradeCount).padStart(6)} | ${(r.winRate * 100).toFixed(1).padStart(4)}% | ${r.totalPnl.toFixed(0).padStart(7)} | ${r.profitFactor.toFixed(2).padStart(4)} | ${r.maxDrawdown.toFixed(0).padStart(6)} | ${r.annualizedSharpeRatio.toFixed(2).padStart(10)} | ${r.annualizedSortinoRatio.toFixed(2).padStart(11)} | ${fmtEq(eq).padStart(11)}`,
      );
    });

    console.log(`\nbatchId: ${batchId}`);
  } finally {
    await closeBacktestResources(dataProvider, resultPool);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
