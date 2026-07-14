import type { BalancePort } from '../../port/BalancePort.js';
import type { Clock } from '../../port/Clock.js';
import { Balance } from '../../domain/Balance.js';
import { Money } from '../../domain/Money.js';
import { BalancePortError } from '../../domain/error/BalancePortError.js';
import { Logger } from '../../infrastructure/logging/Logger.js';
import type { GmoRestClient } from './GmoRestClient.js';

interface BalanceCacheEntry {
  balance: Balance;
  fetchedAtMillis: number;
}

/**
 * GMO FX `/private/v1/account/assets` レスポンス `data` の正本型。
 *
 * FX の同エンドポイントは資産サマリを単一オブジェクトで返す（建玉別 list ではない）。
 * 外部 API 形状に忠実な境界 DTO のため、各フィールドは string のまま保持する
 * （ドメインへ取り込む際に Money / Balance へ変換する。本 Adapter は balance のみ使用）。
 */
export interface GmoAssetsData {
  equity: string;
  availableAmount: string;
  balance: string;
  estimatedTradeFee: string;
  margin: string;
  marginRatio: string;
  positionLossGain: string;
  totalSwap: string;
  transferableAmount: string;
}

/**
 * `BalancePort` の GMO FX 実装。
 *
 * 内部キャッシュ（TTL 注入）で API 呼び出しを最小化する。
 * Adapter 自身は CAPITAL のような環境変数フォールバックを持たない:
 *   - `current()`: キャッシュにフレッシュ値があれば返す。なければ null
 *   - `freshNow()`: キャッシュがフレッシュならその値、そうでなければ API 取得。失敗時は throw
 *
 * 設計書: docs/design/position-manager/policies.md 1.10.3
 *         docs/design/sequence/adapter/gmo-account-assets.md
 */
export class GmoBalanceAdapter implements BalancePort {
  private readonly logger = new Logger('GmoBalanceAdapter', 'BROKER');
  private cache: BalanceCacheEntry | null = null;
  /** 並行 freshNow を 1 本にまとめて API への重複呼び出しを防ぐ。 */
  private inflightFetch: Promise<Balance> | null = null;

  constructor(
    private readonly restClient: GmoRestClient,
    private readonly clock: Clock,
    private readonly cacheTtlMillis: number,
  ) {
    if (!Number.isInteger(cacheTtlMillis) || cacheTtlMillis <= 0) {
      throw new Error(
        `cacheTtlMillis は正の整数: ${cacheTtlMillis}（0 や負数では API 呼び出しが過剰になる）`,
      );
    }
  }

  current(): Balance | null {
    if (this.cache === null) {
      return null;
    }
    if (this.isFresh(this.cache)) {
      return this.cache.balance;
    }
    return null;
  }

  async freshNow(): Promise<Balance> {
    if (this.cache !== null && this.isFresh(this.cache)) {
      return this.cache.balance;
    }
    if (this.inflightFetch !== null) {
      return this.inflightFetch;
    }
    this.inflightFetch = this.fetchAndCache();
    try {
      return await this.inflightFetch;
    } finally {
      this.inflightFetch = null;
    }
  }

  private async fetchAndCache(): Promise<Balance> {
    let response;
    try {
      response = await this.restClient.get<GmoAssetsData>(
        '/private/v1/account/assets',
      );
    } catch (err) {
      if (err instanceof BalancePortError) {
        throw err;
      }
      this.logger.error('残高取得 API が失敗', { error: String(err) });
      throw BalancePortError.apiFailed(err);
    }
    if (!response?.data || typeof response.data.balance !== 'string') {
      throw BalancePortError.malformedResponse('data.balance が string ではない');
    }
    let balance: Balance;
    try {
      balance = Balance.of(Money.jpy(response.data.balance));
    } catch (err) {
      // 機密情報（残高金額）はメッセージに含めない。詳細は cause に保持。
      throw BalancePortError.malformedResponse(
        'balance を Balance に変換できなかった',
        err,
      );
    }
    this.cache = {
      balance,
      fetchedAtMillis: this.clock.now().getTime(),
    };
    // 機密情報（残高金額）はログに出さない。成功イベントのみ記録。
    this.logger.info('残高取得成功');
    return balance;
  }

  private isFresh(entry: BalanceCacheEntry): boolean {
    const ageMillis = this.clock.now().getTime() - entry.fetchedAtMillis;
    return ageMillis <= this.cacheTtlMillis;
  }
}
