/**
 * 価格帯フィルター sweep（SELL 禁止下限の値域、期間別）
 *
 * 仮説: 過去最安値圏（介入警戒ライン付近）では順張り SELL が介入リバウンドで
 *       構造的に負ける。ハードコードだが 2009-2012 ピンポイントで効く可能性。
 *
 * sweep: minSellPrice ∈ {なし, 80, 82, 85, 88, 90}
 * 期間: 20 年 full + 2009-2012（本命）+ 他主要期間
 *
 * Usage: npx tsx scripts/run-bt-price-band-sweep.ts
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

const SELL_FLOORS = [80, 82, 85, 88, 90];

const PERIODS = [
  { label: '20 年 full (2006-2026)',   from: '2006-01-01', to: '2026-03-31' },
  { label: '2009-2012 円高 ★',        from: '2009-01-01', to: '2012-01-01' },
  { label: '2012-2015 アベノミクス',   from: '2012-01-01', to: '2015-01-01' },
  { label: '2015-2019 膠着レンジ',     from: '2015-01-01', to: '2019-01-01' },
  { label: '2022-2026 インフレ円安',   from: '2022-01-01', to: '2026-03-31' },
] as const;

interface StrategyDef {
  readonly key: string;
  readonly minSellPrice?: number;
}

const STRATEGIES: StrategyDef[] = [
  { key: 'A: baseline' },
  ...SELL_FLOORS.map(v => ({ key: `SELL≥${v}円`, minSellPrice: v })),
];

function buildParams(period: (typeof PERIODS)[number], s: StrategyDef): SmaCrossParameters {
  return {
    strategy: 'SMA_CROSS', pair: PAIR, timeframe: TimeFrame.FIFTEEN_MINUTE,
    dateFrom: new Date(`${period.from}T00:00:00Z`),
    dateTo: new Date(`${period.to}T00:00:00Z`),
    shortPeriod: 20, longPeriod: 100,
    stopLossPips: 40, takeProfitPips: 150,
    trailActivatePips: 150, trailWidthPips: 70,
    excludeHoursUtc: [0, 7, 18], maxHoldBars: 192,
    riskPct: 0.02, targetMaintenanceRatio: 1.40, marginRate: 0.04,
    minCrossStrengthPips: 0.1,
    excludeMidMonthJstLunchNonBoj: true,
    maxDirectionalDivergencePct: 0.1,
    ...(s.minSellPrice ? { priceBandFilter: { minSellPrice: s.minSellPrice } } : {}),
  };
}

function fmtEq(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '億';
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString() + '万';
  return Math.round(n).toLocaleString() + '円';
}

async function main(): Promise<void> {
  console.log('=== 価格帯フィルター sweep（SELL 禁止下限 × 期間）===\n');

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
    INITIAL, 'feat/position-manager-dynamic-lot',
  );

  const startTime = Date.now();
  const allResults: { period: string; strategy: string; result: Awaited<ReturnType<typeof runner.run>>[0] }[] = [];

  try {
    for (const period of PERIODS) {
      const batchId = randomUUID();
      const paramsList = STRATEGIES.map(s => buildParams(period, s));
      process.stdout.write(`[${period.label}] ${paramsList.length}候補 ...`);
      const tStart = Date.now();
      const results = await runner.run(paramsList, batchId, `PriceBand sweep ${period.label}`);
      process.stdout.write(` ${((Date.now() - tStart) / 1000).toFixed(1)}s\n`);
      results.forEach((r, i) => allResults.push({ period: period.label, strategy: STRATEGIES[i]!.key, result: r }));
    }
    console.log(`\n全 ${STRATEGIES.length * PERIODS.length} run 完了 (${((Date.now() - startTime) / 1000).toFixed(1)}s)\n`);

    console.log('期間                          | 戦略        | Trades | 勝率 | 総pips | PF   | DD  | Sharpe年率 | 最終 equity');
    console.log('------------------------------|-------------|--------|------|--------|------|-----|------------|-------------');
    for (const period of PERIODS) {
      for (const s of STRATEGIES) {
        const entry = allResults.find(e => e.period === period.label && e.strategy === s.key);
        if (!entry) continue;
        const r = entry.result;
        const eq = r.trades.at(-1)?.equityAfter ?? INITIAL;
        console.log(
          `${period.label.padEnd(30)} | ${s.key.padEnd(11)} | ${String(r.tradeCount).padStart(6)} | ${(r.winRate * 100).toFixed(1).padStart(3)}% | ${r.totalPnl.toFixed(0).padStart(6)} | ${r.profitFactor.toFixed(2).padStart(4)} | ${r.maxDrawdown.toFixed(0).padStart(3)} | ${r.annualizedSharpeRatio.toFixed(2).padStart(10)} | ${fmtEq(eq).padStart(11)}`,
        );
      }
      console.log('                              |             |        |      |        |      |     |            |');
    }
  } finally {
    await closeBacktestResources(dataProvider, resultPool);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
