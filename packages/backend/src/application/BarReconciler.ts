import { CandleHistoryPort } from '../port/CandleHistoryPort.js';
import { TimeFrameBook } from '../domain/market/TimeFrameBook.js';
import { TimeFrame, label as tfLabel } from '../domain/market/TimeFrame.js';
import { Logger } from '../infrastructure/logging/Logger.js';

/**
 * 壁時計に起こされ、公式 klines で確定足・SMA を照合・訂正する調停役。
 *
 * 「いつ照合するか」は BoundaryScheduler（壁時計）が決め、「どう補正するか」は
 * TimeFrameBook（ドメイン）が決める。本クラスはその間を翻訳するだけで、
 * SMA 計算方式・足組立・isStable は一切知らない。
 *
 * 競合制御（BR-10）:
 *   fetchRecent（await）は TimeFrameBook を触らない。取得完了後の
 *   timeFrameBook.reconcile は await を挟まず同期実行するため、その間に
 *   tick 処理が割り込めない（Node.js のイベントループ特性で原子性を担保）。
 */
export class BarReconciler {
  constructor(
    private readonly candleHistoryPort: CandleHistoryPort,
    private readonly timeFrameBook: TimeFrameBook,
    private readonly reconcileBars: number,
    private readonly logger: Logger = new Logger('BarReconciler', 'MARKET'),
  ) {}

  /** 指定時間足を公式値で照合・訂正する。REST 失敗時は WARN を出して return */
  async reconcile(timeFrame: TimeFrame): Promise<void> {
    // ── await をまたぐ区間（ドメイン状態を触らない）──
    let official;
    try {
      official = await this.candleHistoryPort.fetchRecent(timeFrame, this.reconcileBars);
    } catch (err) {
      this.logger.warn('klines 取得失敗。次境界で再試行', {
        timeFrame: tfLabel(timeFrame),
        error: String(err),
      });
      return;
    }

    // ── 同期実行区間（tick は割り込めない＝原子的）──
    const event = this.timeFrameBook.reconcile(timeFrame, official);

    // 是正が起きたときだけ BarReconciled が返る（差分なしは null）
    if (event !== null) {
      this.logger.info(`${tfLabel(timeFrame)}確定足を公式値で補正`, {
        event: 'bar_reconciled',
        timeFrame,
        before: event.before
          ? {
              shortSma: event.before.shortSma.toString(),
              longSma: event.before.longSma.toString(),
            }
          : null,
        after: {
          shortSma: event.after.shortSma.toString(),
          longSma: event.after.longSma.toString(),
        },
      });
    }
  }
}
