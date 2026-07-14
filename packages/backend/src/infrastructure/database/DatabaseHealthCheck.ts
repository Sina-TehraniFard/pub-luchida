/**
 * `DatabaseHealthCheck` が必要とする最小ログ語彙（warn / error のみ）。
 *
 * 具象 `Logger` ではなくこの最小インターフェースに依存させ、結合度を下げる
 * （`Logger` は `implements LogPort` なのでそのまま渡せる。テストも `as unknown` 不要）。
 * リトライ警告と上限到達エラーしか出さないため info / debug は契約に含めない。
 */
export interface StartupHealthLogger {
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * DB に 1 本軽量クエリを投げて疎通を確かめる ping。
 * 本番では `pool.query('SELECT 1')` をラップする。テストでは throw/成功を注入する。
 */
export type DatabasePing = () => Promise<void>;

/** 指定ミリ秒だけ待つ。テストでは即時解決の Fake に差し替えて決定論的に検証する。 */
export type Sleep = (ms: number) => Promise<void>;

/** exponential backoff の設定（Issue #187 確定値）。 */
export interface BackoffConfig {
  /** 初回リトライ前の待機（ms）。 */
  readonly initialDelayMs: number;
  /** 待機時間の倍率。 */
  readonly multiplier: number;
  /** 1 回あたりの待機上限（ms）。 */
  readonly maxDelayMs: number;
  /** ping 失敗時の最大リトライ回数（初回 ping を除く）。 */
  readonly maxRetries: number;
  /**
   * 1 回の ping を待つ上限（ms）。
   *
   * `pool.query('SELECT 1')` は接続確立に失敗してもネットワークが黒穴のとき
   * throw せず無限ブロックしうる（pg プールに query/connection timeout 未設定）。
   * backoff リトライは「throw」でしか発火しないため、timeout が無いと
   * 起動が永久ブロックする。本上限を超えた ping は失敗扱いにして同じ backoff に乗せる。
   */
  readonly pingTimeoutMs: number;
}

/** Issue #187 確定値: 初期 1s / 倍率 2 / 最大 30s / 最大 5 リトライ / ping 上限 5s。 */
export const DEFAULT_BACKOFF: BackoffConfig = {
  initialDelayMs: 1_000,
  multiplier: 2,
  maxDelayMs: 30_000,
  maxRetries: 5,
  pingTimeoutMs: 5_000,
};

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** ping が timeout を超えたことを表す sentinel。catch 側で通常の throw と同じ backoff に乗せる。 */
class PingTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`DB ping が ${timeoutMs}ms 以内に応答しませんでした`);
    this.name = 'PingTimeoutError';
  }
}

/**
 * 起動時の DB 健康度チェック。
 *
 * `positionRepository.openPositions()` のような DB アクセスより前に DB へ ping を打ち、
 * 一時的な接続断・ネットワーク不調を exponential backoff でリトライして吸収する。
 * 規定回数リトライしても疎通しなければ throw し、起動シーケンスを fail-fast させる
 * （PM2 が無限に再起動する「永久起動ループ」を抑止する）。
 *
 * 設計判断（Issue #187 ゴール文言との差分）:
 * ゴールは「openPositions() の throw を exponential backoff でリトライ」だが、本実装は
 * openPositions() 本体ではなく直前に軽量 ping（SELECT 1 相当）を打つ「ping ゲート」方式を採る。
 * ping と openPositions() の実行間隔は短く openPositions() に独自リトライも無いため、
 * ping 通過後に openPositions() 内で一時失敗する残存リスクは小さい。
 * 疎通確認とリトライの責務を単純な ping に閉じ込める方が SRP 上クリーンと判断した。
 *
 * Composition Root（起動シーケンス）に置く infra 部品。ドメインに DB リトライ知識を持ち込まない。
 */
export class DatabaseHealthCheck {
  private readonly config: BackoffConfig;

  constructor(
    private readonly ping: DatabasePing,
    private readonly logger: StartupHealthLogger,
    config: Partial<BackoffConfig> = {},
    private readonly sleep: Sleep = defaultSleep,
  ) {
    this.config = { ...DEFAULT_BACKOFF, ...config };
  }

  /**
   * ping を pingTimeoutMs で打ち切る。期限超過は throw 扱いにして backoff に乗せる
   * （`pool.query` が無限ブロックしても起動シーケンスが止まらないようにする）。
   */
  private async pingWithTimeout(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new PingTimeoutError(this.config.pingTimeoutMs)),
        this.config.pingTimeoutMs,
      );
    });
    try {
      await Promise.race([this.ping(), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * DB へ ping し、成功するまで exponential backoff でリトライする。
   * 規定回数失敗したら最後の error を throw する。
   */
  async ensureHealthy(): Promise<void> {
    let attempt = 0;
    let delayMs = this.config.initialDelayMs;
    let lastError: unknown;

    // 初回 ping + maxRetries 回のリトライ = 最大 (maxRetries + 1) 回試行する。
    // ログでは試行回数を attempt（1 始まり）/ totalAttempts（= maxRetries + 1）で出す。
    // maxRetries は「初回 ping を含まないリトライ回数」なので、運用者が attempt と
    // 突き合わせるときは totalAttempts を上限として見る（attempt は maxRetries+1 まで増える）。
    const totalAttempts = this.config.maxRetries + 1;
    for (;;) {
      try {
        await this.pingWithTimeout();
        return;
      } catch (err) {
        lastError = err;
        if (attempt >= this.config.maxRetries) break;
        this.logger.warn('DB 健康度チェックに失敗。リトライします', {
          event: 'startup_db_unhealthy',
          attempt: attempt + 1,
          totalAttempts,
          maxRetries: this.config.maxRetries,
          nextRetryDelayMs: delayMs,
          error: String(err),
        });
        await this.sleep(delayMs);
        attempt += 1;
        delayMs = Math.min(delayMs * this.config.multiplier, this.config.maxDelayMs);
      }
    }

    this.logger.error('DB 健康度チェックがリトライ上限に達しました。起動を中止します', {
      event: 'startup_db_unhealthy',
      attempt: attempt + 1,
      totalAttempts,
      maxRetries: this.config.maxRetries,
      error: String(lastError),
    });
    throw new Error(
      `DB 健康度チェックに失敗しました（${this.config.maxRetries} 回リトライ後）。` +
      `DB 接続・ネットワークを確認してください。起動を中止します（${String(lastError)}）。`,
    );
  }
}
