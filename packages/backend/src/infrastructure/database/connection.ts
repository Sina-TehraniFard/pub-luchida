import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { Logger } from '../logging/Logger.js';

const logger = new Logger('DatabaseConnection');

/**
 * PostgreSQL 接続を生成する。
 * Composition Root で1回だけ呼ぶ。
 */
export function createDatabase(databaseUrl: string) {
  // connectionTimeoutMillis: 新規接続の確立（TCP/認証ハンドシェイク）を待つ上限。
  // pg のデフォルトは 0（無制限）なので、ネットワーク黒穴では接続試行が OS の TCP
  // タイムアウト（数分）まで無限ブロックし、in-flight な接続がプールを占有し続ける。
  // 上限を設けることで下層の接続試行を実際に終了させ、起動時健康度チェックの
  // ping timeout（pingTimeoutMs）が「待つのをやめる」だけで接続が漏れる問題を断つ。
  // statement_timeout: 接続確立後のクエリ実行が長引いた場合の上限（slow query 対策）。
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });

  pool.on('error', (err) => {
    logger.error('PostgreSQL プール接続エラー', { error: String(err) });
  });

  const db = drizzle(pool);

  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];
