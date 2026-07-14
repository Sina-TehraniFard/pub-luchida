/**
 * TimescaleDB 接続情報。
 */
export interface TimescaleDbConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

/**
 * 環境変数から接続情報を構築する。
 * 必須の環境変数が欠けている場合は例外を投げる。
 */
export function loadTimescaleDbConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TimescaleDbConfig {
  const host = required(env, 'BACKTEST_DB_HOST');
  const portStr = required(env, 'BACKTEST_DB_PORT');
  const port = Number.parseInt(portStr, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`BACKTEST_DB_PORT は正の整数である必要があります: ${portStr}`);
  }
  return {
    host,
    port,
    database: required(env, 'BACKTEST_DB_NAME'),
    user: required(env, 'BACKTEST_DB_USER'),
    password: required(env, 'BACKTEST_DB_PASS'),
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`環境変数 ${key} が設定されていません`);
  }
  return value;
}
