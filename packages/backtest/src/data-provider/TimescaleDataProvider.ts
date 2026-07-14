import { Pool } from 'pg';
import QueryStream from 'pg-query-stream';
import type { PoolClient, QueryResult } from 'pg';

import { durationMs } from '@luchida/backend/domain/market/TimeFrame.js';
import { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import { Price } from '@luchida/backend/domain/market/Price.js';
import { Tick } from '@luchida/backend/domain/market/tick/Tick.js';
import { TickTimestamp } from '@luchida/backend/domain/market/tick/TickTimestamp.js';
import { ConfirmedCandle } from '@luchida/backend/domain/market/candle/ConfirmedCandle.js';
import { CandleOpenTime } from '@luchida/backend/domain/market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '@luchida/backend/domain/market/candle/CandleCloseTime.js';
import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';

import type { DataProvider } from './DataProvider.js';
import type { TimescaleDbConfig } from './TimescaleDbConfig.js';
import type { DateRange } from '../engine/EngineConfig.js';

/**
 * pg.Pool を抽象化するインターフェース。
 * 本番は pg.Pool、テストは Mock を差し込めるように依存を注入可能にする。
 */
export interface PgPoolLike {
  query(sql: string, params: unknown[]): Promise<QueryResult>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

interface CandleRow {
  bucket: Date;
  open: string;
  high: string;
  low: string;
  close: string;
}

interface TickRow {
  time: Date;
  bid: string;
  ask: string;
}

/**
 * TimescaleDB から BT 用のヒストリカルデータを取得する。
 *
 * OHLC は `time_bucket` を使って tick から集約する（タイムフレームごとにテーブルを持たない）。
 * tick は AsyncIterable でストリーミング取得する（件数が膨大になりうるため）。
 *
 * DB クライアントは `PgPoolLike` として注入する。
 * 実運用では `fromConfig()` で pg.Pool を内部生成する。
 */
export class TimescaleDataProvider implements DataProvider {
  /**
   * pair|timeframe|range.from|range.to をキーに、可能な限り余裕を持って取得した
   * confirmedCandle 配列を保持する。warmup が異なる場合は配列の先頭を slice して返す。
   * これにより SMA期間スイープなどで重複保持を避ける。
   */
  private readonly cache = new Map<string, { effectiveFrom: Date; candles: ConfirmedCandle[] }>();

  constructor(private readonly pool: PgPoolLike) {}

  /**
   * 接続情報から pg.Pool を生成して Provider を構築する。
   */
  static fromConfig(config: TimescaleDbConfig): TimescaleDataProvider {
    const pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      // 長時間ストリーミング対応: TCP keepalive を有効化し、接続切断を防ぐ
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      // クライアント/statement タイムアウトを無効化（長時間クエリ許可）
      connectionTimeoutMillis: 0,
      idleTimeoutMillis: 0,
      query_timeout: 0,
      statement_timeout: 0,
    });
    return new TimescaleDataProvider(pool);
  }

  /**
   * 確定足を期間指定で取得する。
   *
   * OHLC は bid 価格から生成する（FX の業界慣行に従う）。
   * BUY エントリーの約定は ask で行われるため、bid-only OHLC との乖離（= スプレッド分）は
   * ExecutionSimulator 側で考慮する必要がある。
   *
   * 呼び出し側（Engine）は range.to を TimeFrame の境界に揃えることを前提とする。
   * range.to が TimeFrame 境界の途中の場合、最後のバケットが不完全足になるが、
   * ConfirmedCandle として返されるため意味的に不正確になる。
   */
  async fetchCandles(
    pair: CurrencyPair,
    timeframe: TimeFrame,
    range: DateRange,
    warmupCount: number,
  ): Promise<ConfirmedCandle[]> {
    const tfMs = durationMs(timeframe);
    const requestedFrom = new Date(range.from.getTime() - tfMs * warmupCount);

    // キャッシュキー: warmup を含まない（同じペア・時間足・期間なら共有）
    const cacheKey = `${pair}|${timeframe}|${range.from.toISOString()}|${range.to.toISOString()}`;
    const cached = this.cache.get(cacheKey);
    // 既存キャッシュが requestedFrom 以前のデータを持っていればそれを使う
    if (cached && cached.effectiveFrom.getTime() <= requestedFrom.getTime()) {
      // 必要な warmup の分だけ先頭から切り出し
      const startIdx = cached.candles.findIndex(c => c.openTime.toDate().getTime() >= requestedFrom.getTime());
      return startIdx > 0 ? cached.candles.slice(startIdx) : cached.candles;
    }

    const bucketInterval = timeFrameToInterval(timeframe);
    const effectiveFrom = requestedFrom;

    const result = await this.pool.query(
      `SELECT
         time_bucket($1::interval, time) AS bucket,
         first(bid, time) AS open,
         max(bid) AS high,
         min(bid) AS low,
         last(bid, time) AS close
       FROM fx_tick
       WHERE pair = $2
         AND time >= $3
         AND time <  $4
       GROUP BY bucket
       ORDER BY bucket`,
      [bucketInterval, pair, effectiveFrom, range.to],
    );

    const candles = (result.rows as CandleRow[]).map((row) =>
      ConfirmedCandle.of({
        open: Price.of(String(row.open)),
        high: Price.of(String(row.high)),
        low: Price.of(String(row.low)),
        close: Price.of(String(row.close)),
        openTime: CandleOpenTime.of(row.bucket),
        closeTime: CandleCloseTime.of(new Date(row.bucket.getTime() + tfMs)),
        timeFrame: timeframe,
      }),
    );
    this.cache.set(cacheKey, { effectiveFrom, candles });
    return candles;
  }

  /**
   * 生 tick を期間指定でストリーミング取得する。
   *
   * 注意: 本体の TickTimestamp.of() は未来日時（Date.now() + 5秒以上）を拒否する。
   * BT は過去データを扱うため現時点では問題ないが、フォワードテスト等で
   * 未来日付のシミュレーションを行う場合は TickTimestamp の制約と衝突する。
   */
  async *fetchTicks(pair: CurrencyPair, range: DateRange): AsyncIterable<Tick> {
    const client = await this.pool.connect();
    let stream: QueryStream | null = null;
    try {
      stream = new QueryStream(
        `SELECT time, bid, ask
           FROM fx_tick
          WHERE pair = $1
            AND time >= $2
            AND time <  $3
          ORDER BY time`,
        [pair, range.from, range.to],
      );
      const queryResult = client.query(stream);
      for await (const row of queryResult as AsyncIterable<TickRow>) {
        yield Tick.of(
          Price.of(String(row.ask)),
          Price.of(String(row.bid)),
          TickTimestamp.of(row.time),
        );
      }
    } finally {
      if (stream) stream.destroy();
      client.release();
    }
  }

  /**
   * 保持している接続プールを閉じる。
   * 同一プロセスで BT を繰り返し回す場合は呼び出し側が明示的に閉じる。
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * durationMs から PostgreSQL の interval 文字列を導出する。
 * TimeFrame を拡張しても durationMs() さえ追加すれば自動対応する。
 */
function timeFrameToInterval(tf: TimeFrame): string {
  const ms = durationMs(tf);
  const minutes = ms / 60_000;
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = hours / 24;
  return `${days} day${days === 1 ? '' : 's'}`;
}
