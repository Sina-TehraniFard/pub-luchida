/**
 * BT 過去実行履歴を DB から表示する。
 *
 * Usage:
 *   npx tsx scripts/query-bt-history.ts             # 最近 20 バッチ
 *   npx tsx scripts/query-bt-history.ts <batchId>   # そのバッチの全 run を表示
 *   npx tsx scripts/query-bt-history.ts search SMA  # description に SMA を含むバッチを検索
 *
 * これで「以前似たような検証やったっけ？」が即座に確認できる。
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { loadTimescaleDbConfigFromEnv } from '../src/data-provider/TimescaleDbConfig.js';

async function listBatches(pool: Pool, limit: number = 20): Promise<void> {
  const res = await pool.query(
    `SELECT
       b.id, b.description, b.strategy, b.pair, b.timeframe,
       b.total_runs, b.completed_runs, b.status,
       to_char(b.started_at, 'YYYY-MM-DD HH24:MI') AS started
     FROM backtest.bt_batches b
     ORDER BY b.started_at DESC
     LIMIT $1`,
    [limit],
  );
  console.log(`最近 ${limit} バッチ:\n`);
  console.log('Started          | Strategy  | Pair    | Timeframe      | Runs  | Status    | Description');
  console.log('-----------------|-----------|---------|----------------|-------|-----------|------------');
  for (const r of res.rows) {
    const runs = `${r.completed_runs}/${r.total_runs}`;
    const desc = (r.description ?? '').slice(0, 60);
    console.log(
      `${r.started} | ${r.strategy.padEnd(9)} | ${r.pair.padEnd(7)} | ${r.timeframe.padEnd(14)} | ${runs.padStart(5)} | ${r.status.padEnd(9)} | ${desc}`,
    );
    console.log(`                 | batchId: ${r.id}`);
  }
  console.log(`\nバッチ詳細: npx tsx scripts/query-bt-history.ts <batchId>`);
}

async function showBatch(pool: Pool, batchId: string): Promise<void> {
  // started_at / finished_at は SQL 側で JST 文字列に整形して返す（#96）。
  // JS の Date.toISOString() は UTC 固定のため、表示は DB のセッション TZ に委ねる。
  const batch = await pool.query(
    `SELECT *,
       to_char(started_at, 'YYYY-MM-DD HH24:MI:SS') AS started_jst,
       to_char(finished_at, 'YYYY-MM-DD HH24:MI:SS') AS finished_jst
     FROM backtest.bt_batches WHERE id = $1`,
    [batchId],
  );
  if (batch.rows.length === 0) {
    console.log(`batchId ${batchId} が見つかりません`);
    return;
  }
  const b = batch.rows[0];
  console.log(`=== Batch ${batchId} ===`);
  console.log(`Description: ${b.description}`);
  console.log(`Strategy:    ${b.strategy} / ${b.pair} / ${b.timeframe}`);
  console.log(`Runs:        ${b.completed_runs}/${b.total_runs} (${b.status})`);
  const finished = b.finished_jst ? `${b.finished_jst} JST` : '-';
  console.log(`Started:     ${b.started_jst} JST`);
  console.log(`Finished:    ${finished}\n`);

  const runs = await pool.query(
    `SELECT
       id, params, total_pnl, profit_factor, win_rate, trade_count,
       max_drawdown, annualized_sharpe_ratio, sqn_capped, standard_metrics_computed,
       max_consecutive_losses
     FROM backtest.bt_runs
     WHERE batch_id = $1
     ORDER BY total_pnl DESC`,
    [batchId],
  );
  // 表示は業界標準値（年率 Sharpe・Van Tharp 原典 SQN）を主軸にする（#99）。
  // per-trade Sharpe は壊滅的に見える誤読を招くため、年率換算値を採用。
  console.log(`Runs (total_pnl DESC):`);
  console.log('#runId                                | total_pnl | PF    | Win%  | Trades |   DD  | Sharpe年率 | SQN(cap) | 連敗 | params');
  console.log('---------------------------------------|-----------|-------|-------|--------|-------|-----------|----------|------|-------');
  for (const r of runs.rows) {
    const params = JSON.stringify(r.params).slice(0, 80);
    // 未計算（migration 004 適用前の旧 run）の sqn_capped=0 は無意味なので
    // 値として表示せず「-」にする（#336）。
    const sqnCapped = r.standard_metrics_computed
      ? Number(r.sqn_capped).toFixed(2).padStart(8)
      : '-'.padStart(8);
    console.log(
      `${r.id} | ${Number(r.total_pnl).toFixed(0).padStart(9)} | ${Number(r.profit_factor).toFixed(3).padStart(5)} | ${(Number(r.win_rate) * 100).toFixed(1).padStart(4)}% | ${String(r.trade_count).padStart(6)} | ${Number(r.max_drawdown).toFixed(0).padStart(5)} | ${Number(r.annualized_sharpe_ratio).toFixed(2).padStart(9)} | ${sqnCapped} | ${String(r.max_consecutive_losses).padStart(4)} | ${params}`,
    );
  }
}

async function searchBatches(pool: Pool, keyword: string): Promise<void> {
  const res = await pool.query(
    `SELECT b.id, b.description, b.strategy, b.pair, b.total_runs, b.started_at::date
     FROM backtest.bt_batches b
     WHERE b.description ILIKE $1
     ORDER BY b.started_at DESC`,
    [`%${keyword}%`],
  );
  console.log(`"${keyword}" を含むバッチ: ${res.rows.length} 件\n`);
  for (const r of res.rows) {
    console.log(`${r.started_at} | ${r.id} | ${r.total_runs} runs | ${r.description}`);
  }
}

async function main(): Promise<void> {
  // max=1 で単一接続に固定する。SET TIME ZONE はセッション単位の設定のため、
  // 接続が複数あると後続クエリが別セッション（UTC のまま）に当たりうる。
  // このスクリプトはクエリを逐次実行するだけなので 1 接続で十分。
  const pool = new Pool({ ...loadTimescaleDbConfigFromEnv(), max: 1 });

  try {
    // BT 結果の TIMESTAMPTZ を JST 表示にする（保存値は UTC のまま / #96）。
    // セッション TZ を設定すれば to_char や ::date も含め全カラムが JST で返る。
    // await で明示実行し、失敗時は握り潰さず例外で落とす（誤った時刻を黙って読まない）。
    await pool.query("SET TIME ZONE 'Asia/Tokyo'");

    const arg = process.argv[2];
    if (!arg) {
      await listBatches(pool);
    } else if (arg === 'search') {
      const keyword = process.argv[3];
      if (!keyword) {
        console.error('Usage: npx tsx scripts/query-bt-history.ts search <keyword>');
        process.exit(1);
      }
      await searchBatches(pool, keyword);
    } else {
      await showBatch(pool, arg);
    }
  } finally {
    // finally 内で throw すると try 本体の例外がマスクされるため、解放失敗はログに留める。
    try {
      await pool.end();
    } catch (e) {
      console.error('BT リソースの解放に失敗しました:', e);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
