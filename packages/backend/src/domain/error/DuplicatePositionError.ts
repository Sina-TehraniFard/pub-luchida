import type { CurrencyPair } from '../market/CurrencyPair.js';
import type { StrategyName } from '../rule/StrategyName.js';

/**
 * 同一 (currencyPair, strategyName) の OPEN ポジションが既に存在する場合のドメインエラー。
 *
 * 2 経路の二段防御を表現する（policies.md 2.6 / 2.7.3）:
 * - **`detectedByDomain`**: ドメインサービス（`PositionManager`）が在庫スナップショットで事前検出した（一次防御）
 * - **`detectedByPersistence`**: DB 部分ユニーク制約違反（Postgres 23505）を adapter 層で捕捉した（二次防御）
 *
 * 設計書: docs/design/position-manager/policies.md 2.6 / 2.7.3。
 *
 * Note: 本 PR 時点では `detectedByDomain` のみ呼ばれる経路がある。DB 部分ユニーク制約は
 * Step5 別 PR で導入予定（policies.md 4.3）、その PR で `PostgresPositionRepository.register`
 * の try/catch に `detectedByPersistence` を組み込む。
 */
export class DuplicatePositionError extends Error {
  private constructor(
    message: string,
    readonly pair: CurrencyPair,
    readonly strategyName: StrategyName,
    readonly origin: DuplicatePositionOrigin,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DuplicatePositionError';
  }

  /** ドメイン側の事前重複チェックで検出されたケース（PositionManager の一次防御） */
  static detectedByDomain(pair: CurrencyPair, strategyName: StrategyName): DuplicatePositionError {
    return new DuplicatePositionError(
      `同一 pair × 同戦略のポジションが既に存在する: pair=${pair.toString()}, strategy=${strategyName}`,
      pair,
      strategyName,
      'DOMAIN',
    );
  }

  /** 永続化層が UNIQUE 制約違反（Postgres 23505）を捕捉したケース */
  static detectedByPersistence(
    pair: CurrencyPair,
    strategyName: StrategyName,
    cause?: unknown,
  ): DuplicatePositionError {
    return new DuplicatePositionError(
      `同一 pair × 同戦略のポジションが既に存在する: pair=${pair.toString()}, strategy=${strategyName}`,
      pair,
      strategyName,
      'PERSISTENCE',
      cause !== undefined ? { cause } : undefined,
    );
  }
}

export type DuplicatePositionOrigin = 'DOMAIN' | 'PERSISTENCE';
