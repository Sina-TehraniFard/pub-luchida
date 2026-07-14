import type { Broker } from '../../port/Broker.js';
import { EntryCommand } from '../../domain/command/EntryCommand.js';
import { EntryResult } from '../../domain/market/EntryResult.js';
import { ExitResult } from '../../domain/market/ExitResult.js';
import { Position } from '../../domain/position/Position.js';
import { PositionId } from '../../domain/position/PositionId.js';
import type { CurrencyPair } from '../../domain/market/CurrencyPair.js';
import { Price } from '../../domain/market/Price.js';
import { Pips } from '../../domain/market/Pips.js';
import { Timestamp } from '../../domain/market/Timestamp.js';
import { BrokerError } from '../../domain/error/BrokerError.js';
import type { GmoRestClient } from './GmoRestClient.js';
import { GmoApiError } from './GmoApiError.js';
import { Logger } from '../../infrastructure/logging/Logger.js';

/**
 * Broker の実装。
 * GMO FX API の speedOrder（エントリー）と closeOrder（決済）を通じて注文を実行する。
 * ドメインの EntryCommand/Position を GMO API パラメータに変換し、
 * レスポンスを EntryResult/ExitResult に変換する翻訳者。
 */
export class GmoBrokerAdapter implements Broker {
  private readonly logger = new Logger('GmoBrokerAdapter', 'TRADE');

  private static readonly EXECUTION_POLL_INTERVAL_MS = 500;
  private static readonly EXECUTION_POLL_MAX_ATTEMPTS = 20;
  /** openPositions API の 1 ページあたり取得件数（GMO の上限値）。 */
  private static readonly OPEN_POSITIONS_PAGE_SIZE = 100;
  /**
   * openPositions の全件取得で許容する最大ページ数。
   * 正常時は prevId カーソルが単調減少して終端するが、API 仕様変更や
   * 想定外レスポンスで毎ページ満杯が返り続けても市場監視ループ内で暴走しないよう、
   * 上限を超えたら fail-fast する安全弁。
   */
  private static readonly OPEN_POSITIONS_MAX_PAGES = 100;

  constructor(private readonly restClient: GmoRestClient) {}

  async placeEntry(command: EntryCommand): Promise<EntryResult> {
    this.logger.info(`GMO注文送信 ${command.buySell} ${command.pair} ${command.lot.toString()}通貨`, {
      pair: command.pair,
      side: command.buySell,
      lot: command.lot.toString(),
    });

    try {
      // speedOrder で成行注文
      const orderResponse = await this.restClient.post<GmoSpeedOrderData[]>(
        '/private/v1/speedOrder',
        {
          symbol: command.pair,
          side: command.buySell,
          size: command.lot.toString(),
          isHedgeable: true,
        },
      );

      const orderData = orderResponse.data[0];
      const orderId = String(orderData.orderId);
      this.logger.info(`GMO注文受付 orderId=${orderId} ${orderData.status}`, { orderId, status: orderData.status });

      // executions から約定価格を取得
      const execution = await this.waitForExecution(orderId);

      // openPositions から closeOrder 用の positionId を取得
      // （executions の positionId と openPositions の positionId は別物）
      const openPosition = await this.findOpenPosition(
        command.pair,
        execution.timestamp,
        execution.side,
        execution.size,
      );

      const positionId = PositionId.from(String(openPosition.positionId));

      const entryResult = EntryResult.of({
        positionId,
        entryPrice: Price.of(execution.price),
        executedAt: Timestamp.of(new Date(execution.timestamp)),
      });

      this.logger.info(`エントリー約定 positionId=${positionId.toString()} price=${execution.price}`, {
        positionId: positionId.toString(),
        price: execution.price,
      });

      return entryResult;
    } catch (err) {
      if (err instanceof BrokerError) throw err;
      if (err instanceof GmoApiError) {
        throw BrokerError.orderRejected(err.message, err);
      }
      throw BrokerError.networkError(err);
    }
  }

  async placeExit(position: Position): Promise<ExitResult> {
    const closeSide = position.buySell === 'BUY' ? 'SELL' : 'BUY';

    this.logger.info(`GMO決済送信 ${closeSide} positionId=${position.id.toString()}`, {
      positionId: position.id.toString(),
      pair: position.pair,
    });

    try {
      // closeOrder で決済
      const orderResponse = await this.restClient.post<GmoCloseOrderData[]>(
        '/private/v1/closeOrder',
        {
          symbol: position.pair,
          side: closeSide,
          executionType: 'MARKET',
          settlePosition: [
            { positionId: Number(position.id.toString()), size: position.lot.toString() },
          ],
        },
      );

      const orderData = orderResponse.data[0];
      const orderId = String(orderData.orderId);
      this.logger.info('決済注文受付', { orderId });

      // executions から決済価格を取得
      const execution = await this.waitForExecution(orderId);

      const exitResult = ExitResult.of({
        exitPrice: Price.of(execution.price),
        executedAt: Timestamp.of(new Date(execution.timestamp)),
        profitLoss: Pips.of(execution.lossGain ?? '0'),
      });

      this.logger.info(`決済約定 price=${execution.price} P/L=${execution.lossGain ?? '0'}`, {
        price: execution.price,
        profitLoss: execution.lossGain,
      });

      return exitResult;
    } catch (err) {
      if (err instanceof BrokerError) throw err;
      if (err instanceof GmoApiError) {
        throw BrokerError.orderRejected(err.message, err);
      }
      throw BrokerError.networkError(err);
    }
  }

  async verifyConnectivity(): Promise<void> {
    // 軽量な private API（口座資産）を 1 本叩き、認証ヘッダが受理されるか確認する。
    // 成功すれば API キー・シークレットが正しく結線されていると判断できる。
    // 失敗は原因別に撃ち分ける（認証失敗・レート制限・通信断・想定外）。
    // どの失敗でも起動時 fail-fast の対象だが、原因が分からないと運用者が
    // 正しい鍵を疑って時間を溶かす（#287 と逆向きの事故）ため診断性を保つ。
    try {
      await this.restClient.get('/private/v1/account/assets');
    } catch (err) {
      if (err instanceof GmoApiError) {
        if (err.isAuthenticationFailed()) {
          throw BrokerError.authenticationFailed(err);
        }
        if (err.isRateLimited()) {
          throw BrokerError.rateLimited(err);
        }
        // 認証失敗でもレート制限でもない API エラー。運用者が原因を追えるよう
        // GMO の生の status / message_code を残す（placeEntry のポーリングと対称）。
        this.logger.error('接続性確認で想定外の API エラー', {
          status: err.statusCode,
          messages: err.apiMessages.map((m) => m.message_code),
        });
        throw BrokerError.unexpected(`接続性確認に失敗: ${err.message}`, err);
      }
      throw BrokerError.networkError(err);
    }
  }

  async fetchOpenPositionIds(pair: CurrencyPair): Promise<readonly PositionId[]> {
    try {
      const ids: PositionId[] = [];

      // openPositions は 1 ページ最大 OPEN_POSITIONS_PAGE_SIZE 件。
      // 建玉が上限を超えると複数ページに分割されるため、prevId カーソルで全件取得する。
      // prevId を指定すると positionId がそれより小さい建玉（降順の続き）が返る。
      // 終端判定は取得件数がページサイズ未満かどうかで行う（pagination フィールドには依存しない）。
      let prevId: number | undefined;
      for (let page = 0; ; page++) {
        // API 仕様変更や想定外レスポンスでカーソルが終端しない場合の暴走防止。
        // 正常時はカーソルが単調減少して必ず終端するため、ここに到達するのは異常。
        // 建玉が MAX_PAGES * PAGE_SIZE 件ちょうど（全ページ満杯）のときは終端を確認する
        // 追加 1 ページの取得が要るため、page > MAX_PAGES（= 追加 1 回を許容）で判定する。
        if (page > GmoBrokerAdapter.OPEN_POSITIONS_MAX_PAGES) {
          throw BrokerError.unexpected(
            `建玉一覧の全件取得がページ上限 ${GmoBrokerAdapter.OPEN_POSITIONS_MAX_PAGES} を超過`,
          );
        }

        const params: Record<string, string> = {
          symbol: pair,
          count: String(GmoBrokerAdapter.OPEN_POSITIONS_PAGE_SIZE),
        };
        if (prevId !== undefined) {
          params.prevId = String(prevId);
        }

        const response = await this.restClient.get<GmoOpenPositionsResponse>(
          '/private/v1/openPositions',
          params,
        );

        const list = response.data?.list ?? [];
        for (const pos of list) {
          ids.push(PositionId.from(String(pos.positionId)));
        }

        // 取得件数がページサイズ未満なら最終ページ。これ以上の建玉は無い。
        if (list.length < GmoBrokerAdapter.OPEN_POSITIONS_PAGE_SIZE) {
          break;
        }

        // 次ページのカーソルは、今回取得分で最も小さい positionId。
        // GMO は降順前提なので list 末尾でも同義だが、min を取れば並び順の仮定に
        // 依存せず、prevId が前ページ以上に転じない（=必ず前進する）ことも保証できる。
        const nextPrevId = list.reduce(
          (min, pos) => (pos.positionId < min ? pos.positionId : min),
          list[0].positionId,
        );

        // カーソルが減少しない（同値・増加）のは異常。無限ループを断つため fail-fast。
        if (prevId !== undefined && nextPrevId >= prevId) {
          throw BrokerError.unexpected(
            `建玉一覧のページングカーソルが前進しない（prevId=${prevId}, next=${nextPrevId}）`,
          );
        }
        prevId = nextPrevId;
      }

      return ids;
    } catch (err) {
      // ループ内の暴走防止ガードが投げた BrokerError はそのまま伝播させる
      // （NETWORK_ERROR へ再分類すると UNEXPECTED の意図が失われる）。
      if (err instanceof BrokerError) {
        throw err;
      }
      if (err instanceof GmoApiError) {
        throw BrokerError.unexpected(`建玉一覧の取得に失敗: ${err.message}`, err);
      }
      throw BrokerError.networkError(err);
    }
  }

  /**
   * 約定をポーリングで待つ。
   * speedOrder / closeOrder の直後、executions API で約定情報を取得する。
   */
  private async waitForExecution(orderId: string): Promise<GmoExecution> {
    for (
      let attempt = 0;
      attempt < GmoBrokerAdapter.EXECUTION_POLL_MAX_ATTEMPTS;
      attempt++
    ) {
      try {
        const response = await this.restClient.get<GmoExecutionsResponse>(
          '/private/v1/executions',
          { orderId },
        );

        const executions = response.data?.list;
        if (executions && executions.length > 0) {
          return executions[0];
        }
      } catch (err) {
        if (err instanceof GmoApiError) {
          this.logger.error('約定ポーリング中に API エラー', {
            orderId,
            status: err.statusCode,
            message: err.message,
          });
          throw BrokerError.orderRejected(
            `約定確認中にAPIエラー: ${err.message}`,
            err,
          );
        }
        this.logger.warn('約定ポーリング失敗。リトライ', {
          orderId,
          attempt,
          error: String(err),
        });
      }

      await sleep(GmoBrokerAdapter.EXECUTION_POLL_INTERVAL_MS);
    }

    throw BrokerError.executionTimeout(orderId);
  }

  /**
   * openPositions から最も新しいポジションを見つける。
   * speedOrder 直後に呼ぶため、最新のポジションが今回エントリーしたもの。
   * タイムスタンプ + side + size で照合して誤マッチを防ぐ。
   */
  private async findOpenPosition(
    symbol: string,
    _executionTimestamp: string,
    side: string,
    size: string,
  ): Promise<GmoOpenPosition> {
    const response = await this.restClient.get<GmoOpenPositionsResponse>(
      '/private/v1/openPositions',
      { symbol },
    );

    const list = response.data?.list;
    if (!list || list.length === 0) {
      throw BrokerError.unexpected('openPositions が空。約定直後にポジションが見つからない');
    }

    // side と size が一致するポジションに絞り込む
    const candidates = list.filter(pos => pos.side === side && pos.size === size);

    const targetList = candidates.length > 0 ? candidates : list;

    // 最も新しい（timestamp が最大の）ポジションを選ぶ
    let newest = targetList[0];
    for (const pos of targetList) {
      if (new Date(pos.timestamp).getTime() > new Date(newest.timestamp).getTime()) {
        newest = pos;
      }
    }

    this.logger.info('openPositions からポジションを特定', {
      positionId: newest.positionId,
      timestamp: newest.timestamp,
      side: newest.side,
      size: newest.size,
    });

    return newest;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GMO speedOrder レスポンスの配列要素 */
interface GmoSpeedOrderData {
  orderId: number;
  rootOrderId: number;
  status: string;
  symbol: string;
  side: string;
  size: string;
  settleType: string;
  executionType: string;
  timestamp: string;
}

/** GMO closeOrder レスポンスの配列要素 */
interface GmoCloseOrderData {
  orderId: number;
  rootOrderId: number;
  status: string;
}

/** GMO executions レスポンス */
interface GmoExecutionsResponse {
  list: GmoExecution[];
}

/** GMO 約定情報 */
interface GmoExecution {
  executionId: number;
  orderId: number;
  positionId: number;
  symbol: string;
  side: string;
  settleType: string;
  size: string;
  price: string;
  lossGain?: string;
  timestamp: string;
}

/** GMO openPositions レスポンス */
interface GmoOpenPositionsResponse {
  list: GmoOpenPosition[];
  /**
   * GMO が返すページング情報。
   * 現状の全件取得ロジックは「取得件数がページサイズ未満かどうか」で終端を判定しており、
   * このフィールドは読まない。レスポンス契約として型に残すのみ（将来 pagination 駆動の
   * 終端判定へ切り替える余地はあるが #269 のスコープ外）。
   */
  pagination?: GmoPagination;
}

/**
 * GMO ページング情報。
 * 現状は終端判定に使っていない（GmoOpenPositionsResponse のコメント参照）。
 */
interface GmoPagination {
  currentPage: number;
  count: number;
}

/** GMO 建玉情報 */
interface GmoOpenPosition {
  positionId: number;
  symbol: string;
  side: string;
  size: string;
  price: string;
  lossGain: string;
  timestamp: string;
}
