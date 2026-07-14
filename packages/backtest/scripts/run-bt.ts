/**
 * Luchida BT ベースライン実行スクリプト（Postgres 永続化）
 *
 * 結果は tick_data.backtest スキーマの bt_batches / bt_runs / bt_trades に保存される。
 * 全ての BT 記録は DB で検索可能なので、過去検証が埋もれない。
 *
 * Usage:
 *   npx tsx scripts/run-bt.ts "このバッチの目的を書く"
 *   npx tsx scripts/run-bt.ts   # description 省略時は default 文言
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

// ============================================================
// ベースライン ParameterSet（20年 BT で検証済み）
// ============================================================
const params: SmaCrossParameters = {
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
  maxHoldBars: 192, // 48h
  riskPct: 0.02, // リスクベース Lot は backend 未実装のため BT では未参照（#306）
  targetMaintenanceRatio: 1.40,
  marginRate: 0.04,
  minCrossStrengthPips: 0.1, // 4観点分析で採用（除外50件の期待値-3 pips/件、スリッページ耐性あり、21年中11勝1敗）
  excludeMidMonthJstLunchNonBoj: true, // 16-21日 JST昼 × 非BOJ日（72件の-7 pips/件負け群を除外）
  maxDirectionalDivergencePct: 0.1, // WF 16 年 sweep で採用判定（PF中央値 1.47 / Sharpe 最悪 -0.38 / DD 最悪 542pips）
  priceBandFilter: { minSellPrice: 85 }, // 85円未満での SELL 禁止（介入警戒圏で順張りショートが刈られるのを回避）
};

async function main() {
  const description = process.argv[2] ?? 'ベースライン定期再計算';

  console.log('=== Luchida BT 実行 ===');
  console.log(`description: ${description}`);
  console.log(`ペア: ${params.pair} / 時間足: ${params.timeframe}`);
  console.log(`期間: ${params.dateFrom.toISOString().slice(0, 10)} ~ ${params.dateTo.toISOString().slice(0, 10)}`);
  console.log(`戦略: SMA(${params.shortPeriod}/${params.longPeriod}) SL${params.stopLossPips} Trail${params.trailActivatePips}/${params.trailWidthPips} maxHold${params.maxHoldBars}`);
  console.log(`Lot: MaintenanceRatioBased 維持率${(params.targetMaintenanceRatio! * 100).toFixed(0)}%`);
  console.log(`保存先: tick_data.backtest スキーマ\n`);

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
  const startTime = Date.now();
  console.log('BT 実行中...');

  try {
    const [r] = await runner.run([params], batchId, description);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`完了 (${elapsed}s)\n`);

    const lastTrade = r!.trades.at(-1);
    const equity = lastTrade?.equityAfter ?? INITIAL;
    const yearly = (Math.pow(equity / INITIAL, 1 / 20) - 1) * 100;
    const monthly = (Math.pow(equity / INITIAL, 1 / 240) - 1) * 100;
    const eqStr = equity >= 1e8 ? (equity / 1e8).toFixed(2) + '億円'
      : equity >= 1e4 ? Math.round(equity / 1e4).toLocaleString() + '万円'
      : Math.round(equity).toLocaleString() + '円';

    console.log('=== 結果 ===');
    console.log(`トレード数: ${r!.tradeCount}`);
    console.log(`勝率: ${(r!.winRate * 100).toFixed(1)}%`);
    console.log(`総損益: ${r!.totalPnl.toFixed(1)} pips`);
    console.log(`PF: ${r!.profitFactor.toFixed(2)}`);
    console.log(`最大DD: ${r!.maxDrawdown.toFixed(1)} pips`);
    console.log(`シャープ: per-trade ${r!.sharpeRatio.toFixed(3)} / 年率換算 ${r!.annualizedSharpeRatio.toFixed(2)}`);
    console.log(`連勝: ${r!.maxConsecutiveWins} / 連敗: ${r!.maxConsecutiveLosses}`);
    console.log(`初期: ${INITIAL.toLocaleString()}円 → 最終: ${eqStr}`);
    console.log(`年利: ${yearly.toFixed(1)}% / 月利: ${monthly.toFixed(2)}%`);

    console.log('\n=== DB 保存確認 ===');
    console.log(`batchId: ${batchId}`);
    console.log(`runId:   ${r!.id}`);
    console.log(`クエリ例: SELECT * FROM backtest.bt_runs WHERE batch_id = '${batchId}';`);
  } finally {
    await closeBacktestResources(dataProvider, resultPool);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
