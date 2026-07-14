import type { Broker } from '../port/Broker.js';
import type { PositionRepository } from '../port/PositionRepository.js';
import type { LogPort } from '../domain/port/LogPort.js';
import { NoopLogPort } from '../domain/port/NoopLogPort.js';
import type { AuthFailureReportPort } from '../domain/port/AuthFailureReportPort.js';
import { NoopAuthFailureReport } from '../domain/port/AuthFailureReportPort.js';
import { AuthAttemptOutcome } from '../domain/guard/AuthAttemptOutcome.js';
import { BrokerError } from '../domain/error/BrokerError.js';
import type { CurrencyPair } from '../domain/market/CurrencyPair.js';

/** 建玉同期の結果。 */
export interface SyncPositionsResult {
  /** DB 上の OPEN ポジション数（対象ペアのみ・同期前） */
  readonly dbOpen: number;
  /** ブローカー側に現存する建玉数 */
  readonly brokerOpen: number;
  /** CLOSED に更新した件数 */
  readonly synced: number;
}

/**
 * ブローカー建玉と DB の OPEN ポジションを同期する UseCase。
 * ブローカー側に存在しない（= 外部で決済済みの）DB ポジションを CLOSED に更新する。
 *
 * 呼び出し元は 2 つ:
 * - ExpressServer POST /api/sync（手動同期）
 * - main.ts の定期 sync（1 分間隔）
 *
 * 設計書: docs/design/sequence/core/usecase-layer.md「建玉同期」
 */
export class SyncPositionsUseCase {
  constructor(
    private readonly pair: CurrencyPair,
    private readonly broker: Broker,
    private readonly positionRepository: PositionRepository,
    private readonly logger: LogPort = NoopLogPort,
    /** 認証成否を番人に報告する書き口（#290 Step2）。番人不在の構成では Noop */
    private readonly authReporter: AuthFailureReportPort = NoopAuthFailureReport,
  ) {}

  async execute(): Promise<SyncPositionsResult> {
    // DB 読み取り → ブローカー照会の順序は不変条件。
    // 逆順だと「照会後・DB 読み取り前」に約定した新規ポジションが
    // 「ブローカーに存在しない」と誤判定され、実建玉が CLOSED 化される。
    // DB に存在する時点でブローカーには既に存在していた（register は約定後）ため、
    // 後から照会して不在なら決済済みと確定できる。
    const dbPositions = (await this.positionRepository.openPositions()).forPair(this.pair);

    // 認証を伴う唯一の private 呼び出し。成否を番人に報告する（#290 Step2）。
    // 認証失敗のみ report(failed)。それ以外の例外（通信断等）はカウント中立。
    // markClosed（DB 操作）の失敗は認証と無関係なので報告対象に含めない。
    let brokerIds;
    try {
      brokerIds = await this.broker.fetchOpenPositionIds(this.pair);
    } catch (err) {
      if (err instanceof BrokerError && err.isAuthenticationFailure()) {
        this.authReporter.report(AuthAttemptOutcome.failed());
      }
      throw err;
    }
    this.authReporter.report(AuthAttemptOutcome.succeeded());

    const externallyClosed = dbPositions.missingFrom(brokerIds);

    // 更新は個別実行 + 失敗時 fail-fast（途中で失敗したら残りは処理しない）。
    // markClosed の失敗は DB 系統の障害である可能性が高く、握り潰して続行すると
    // 障害を隠す。未処理分は次回 sync（1 分間隔）で再試行され、最終的に収束する。
    let synced = 0;
    for (const position of externallyClosed) {
      this.logger.warn('ブローカーに存在しないポジションを CLOSED に更新', {
        id: position.id.toString(),
      });
      await this.positionRepository.markClosed(position.id);
      synced++;
    }

    if (synced > 0) {
      this.logger.info(`建玉同期 DB=${dbPositions.count()}件 ブローカー=${brokerIds.length}件 更新=${synced}件`, {
        dbOpen: dbPositions.count(),
        brokerOpen: brokerIds.length,
        synced,
      });
    }

    return { dbOpen: dbPositions.count(), brokerOpen: brokerIds.length, synced };
  }
}
