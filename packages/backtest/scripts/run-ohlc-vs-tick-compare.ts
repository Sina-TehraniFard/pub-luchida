/**
 * ベースライン（OHLC モード）と Phase 2（TICK モード）の比較 BT
 *
 * OHLC モード: 足の close で判定、次足 open で約定（IdealExecutionSimulator）
 * TICK モード: tick ストリームで判定、遅延 + スリッページ付き約定（RealisticExecutionSimulator）
 *
 * 20年分の tick 処理は重いので 1 年で比較する。
 *
 * Usage: npx tsx scripts/run-ohlc-vs-tick-compare.ts
 */
import 'dotenv/config';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import { pipValuePerLotJpy } from '@luchida/backend/domain/market/PipUnit.js';
import { TimescaleDataProvider } from '../src/data-provider/TimescaleDataProvider.js';
import { loadTimescaleDbConfigFromEnv } from '../src/data-provider/TimescaleDbConfig.js';
import { JsonResultStore } from '../src/result/JsonResultStore.js';
import { BacktestRunner } from '../src/runner/Runner.js';
import { BacktestSmaCalculatorFactory } from '../src/snapshot-adapter/BacktestSmaCalculatorFactory.js';
import { EngineMode } from '../src/engine/EngineConfig.js';
import type { SmaCrossParameters } from '../src/parameter/ParameterSet.js';
import type { BacktestResult } from '../src/result/BacktestResult.js';

const PAIR = CurrencyPair('USD_JPY');
const INITIAL = 100_000;
const PIP_VALUE = pipValuePerLotJpy(PAIR);

const BASE_PARAMS: SmaCrossParameters = {
  strategy: 'SMA_CROSS',
  pair: PAIR,
  timeframe: TimeFrame.FIFTEEN_MINUTE,
  // 直近3年（2023-04 〜 2026-03）
  dateFrom: new Date('2023-04-01T00:00:00Z'),
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
};

function calcEquity(r: BacktestResult, slPips: number, riskPct: number): number {
  let equity = INITIAL;
  for (const t of r.trades) {
    const riskAmount = equity * riskPct;
    const rawLot = Math.floor(riskAmount / (slPips * PIP_VALUE));
    const lot = Math.min(Math.max(Math.floor(rawLot / 100) * 100, 100), 500_000);
    equity += t.pnl * PIP_VALUE * lot;
  }
  return equity;
}

function fmtJpy(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '億';
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString() + '万';
  return Math.round(n).toLocaleString() + '円';
}

async function main() {
  console.log('=== OHLC（ベースライン）vs TICK（Phase 2）比較 BT ===');
  console.log(`USD/JPY 15分足 SMA(20/100) SL40/TP150 48h制限 リスク2%`);
  console.log(`期間: ${BASE_PARAMS.dateFrom.toISOString().slice(0,10)} 〜 ${BASE_PARAMS.dateTo.toISOString().slice(0,10)}\n`);

  const provider = TimescaleDataProvider.fromConfig(loadTimescaleDbConfigFromEnv());

  const smaFactory = new BacktestSmaCalculatorFactory();

  // ---- OHLC モード ----
  console.log('[OHLC] 実行中...');
  const ohlcStart = Date.now();
  const ohlcRunner = new BacktestRunner(
    new JsonResultStore('./bt-results/ohlc-vs-tick/ohlc'),
    null,
    () => provider,
    smaFactory,
    EngineMode.OHLC,
    { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 },
  );
  const [ohlcResult] = await ohlcRunner.run([BASE_PARAMS], `ohlc-${Date.now()}`);
  const ohlcMs = Date.now() - ohlcStart;
  console.log(`[OHLC] 完了 (${(ohlcMs / 1000).toFixed(1)}s)\n`);

  // ---- TICK モード ----
  console.log('[TICK] 実行中（重い処理、数分かかる見込み）...');
  const tickStart = Date.now();
  const tickRunner = new BacktestRunner(
    new JsonResultStore('./bt-results/ohlc-vs-tick/tick'),
    null,
    () => provider,
    smaFactory,
    EngineMode.TICK,
    {
      slippageStddevPips: 0.3,    // 業界中央値
      executionDelayMs: 100,      // GMO 相当
      randomSeed: 42,
    },
  );
  const [tickResult] = await tickRunner.run([BASE_PARAMS], `tick-${Date.now()}`);
  const tickMs = Date.now() - tickStart;
  console.log(`[TICK] 完了 (${(tickMs / 1000).toFixed(1)}s)\n`);

  // ---- 比較 ----
  const ohlcEquity = calcEquity(ohlcResult!, BASE_PARAMS.stopLossPips, BASE_PARAMS.riskPct);
  const tickEquity = calcEquity(tickResult!, BASE_PARAMS.stopLossPips, BASE_PARAMS.riskPct);

  console.log('┌──────────────────┬──────────────┬──────────────┬──────────────┐');
  console.log('│ 指標             │   OHLC       │   TICK       │   差         │');
  console.log('├──────────────────┼──────────────┼──────────────┼──────────────┤');
  console.log(`│ トレード数       │ ${String(ohlcResult!.tradeCount).padStart(8)}     │ ${String(tickResult!.tradeCount).padStart(8)}     │ ${(tickResult!.tradeCount - ohlcResult!.tradeCount).toString().padStart(8)}     │`);
  console.log(`│ 勝率             │ ${(ohlcResult!.winRate*100).toFixed(1).padStart(7)}%     │ ${(tickResult!.winRate*100).toFixed(1).padStart(7)}%     │ ${((tickResult!.winRate - ohlcResult!.winRate)*100).toFixed(1).padStart(7)}pp    │`);
  console.log(`│ 総損益 (pips)    │ ${ohlcResult!.totalPnl.toFixed(0).padStart(10)}   │ ${tickResult!.totalPnl.toFixed(0).padStart(10)}   │ ${(tickResult!.totalPnl - ohlcResult!.totalPnl).toFixed(0).padStart(10)}   │`);
  console.log(`│ PF               │ ${ohlcResult!.profitFactor.toFixed(2).padStart(8)}     │ ${tickResult!.profitFactor.toFixed(2).padStart(8)}     │ ${(tickResult!.profitFactor - ohlcResult!.profitFactor).toFixed(2).padStart(8)}     │`);
  console.log(`│ 最大DD (pips)    │ ${ohlcResult!.maxDrawdown.toFixed(0).padStart(10)}   │ ${tickResult!.maxDrawdown.toFixed(0).padStart(10)}   │ ${(tickResult!.maxDrawdown - ohlcResult!.maxDrawdown).toFixed(0).padStart(10)}   │`);
  console.log(`│ 最終資金         │ ${fmtJpy(ohlcEquity).padStart(10)}   │ ${fmtJpy(tickEquity).padStart(10)}   │ ${fmtJpy(tickEquity - ohlcEquity).padStart(10)}   │`);
  console.log(`│ 実行時間         │ ${(ohlcMs / 1000).toFixed(1).padStart(8)}s    │ ${(tickMs / 1000).toFixed(1).padStart(8)}s    │              │`);
  console.log('└──────────────────┴──────────────┴──────────────┴──────────────┘');

  const degradation = ohlcResult!.totalPnl !== 0
    ? ((tickResult!.totalPnl - ohlcResult!.totalPnl) / Math.abs(ohlcResult!.totalPnl) * 100)
    : 0;
  console.log(`\nTICK モードでの劣化率: ${degradation.toFixed(1)}% (スリッページ + 約定遅延の影響)`);

  await provider.close();
}

main();
