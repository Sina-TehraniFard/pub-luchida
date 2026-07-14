import { TimeFrame, durationMs } from '../TimeFrame.js';
import { Tick } from '../tick/Tick.js';
import { CandleCloseTime } from './CandleCloseTime.js';
import { CandleEvent } from './CandleEvent.js';
import { ConfirmedCandle } from './ConfirmedCandle.js';
import { FormingCandle } from './FormingCandle.js';

/**
 * tick を受け取り、ローソク足を組み立てる。
 *
 * - 同じ時間枠の tick が来たら FormingCandle を更新して UPDATED を返す
 * - 新しい時間枠の tick が来たら現在の足を確定し、新しい足を開始して CONFIRMED を返す
 *
 * 外部ライブラリへの依存ゼロ。SMA などの指標を知らない。
 * 足が確定した後は lastConfirmed() で取得できる。
 */
export class CandleAccumulator {
  private _forming: FormingCandle | null = null;
  private _lastConfirmed: ConfirmedCandle | null = null;

  constructor(private readonly _timeFrame: TimeFrame) {}

  /**
   * tick を受け取り、足の状態を更新する。
   *
   * @returns CandleEvent.updated()  — 既存の足を更新した
   * @returns CandleEvent.confirmed() — 足が確定した（lastConfirmed() に新しい確定足が入る）
   */
  accumulate(tick: Tick): CandleEvent {
    const tickMs = tick.timestamp().toDate().getTime();
    const duration = durationMs(this._timeFrame);
    // TODO: 日足の期間境界は UTC 0時で計算している。
    //       FX では NY クローズ（EST 17:00）が一般的。
    //       ブローカー対応時に TimeFrame.periodStartOf(timestamp) に抽出する。
    const tickPeriodStart = Math.floor(tickMs / duration) * duration;

    if (this._forming === null) {
      this._forming = FormingCandle.open(tick, this._timeFrame);
      return CandleEvent.updated();
    }

    const formingPeriodStart =
      Math.floor(this._forming.openTime().toDate().getTime() / duration) * duration;

    if (tickPeriodStart === formingPeriodStart) {
      // 同じ期間: 現在の足を更新する
      return this._forming.update(tick);
    }

    // 新しい期間: 現在の足を確定し、新しい足を開く
    const closeTime = CandleCloseTime.of(new Date(formingPeriodStart + duration));
    this._forming.confirm(closeTime);
    this._lastConfirmed = this._forming.toConfirmed(closeTime);
    this._forming = FormingCandle.open(tick, this._timeFrame);
    return CandleEvent.confirmed();
  }

  /**
   * 現在形成中の足。最初の tick が来るまでは null。
   */
  currentForming(): FormingCandle | null {
    return this._forming;
  }

  /**
   * 最後に確定した足。まだ1本も確定していない場合は null。
   */
  lastConfirmed(): ConfirmedCandle | null {
    return this._lastConfirmed;
  }

  /**
   * warmUp 用: 過去の確定足をセットする。
   * TimeFrameBook の初期化時に使う。最初の tick が来る前に
   * lastConfirmed() を返せるようにするため。
   * 配列の最後の1本を _lastConfirmed にセットする。
   */
  seedHistory(candles: ConfirmedCandle[]): void {
    if (candles.length === 0) {
      throw new Error('seedHistory: 空の配列は受け付けません');
    }
    this._lastConfirmed = candles[candles.length - 1];
  }

  /**
   * 直近の確定足を公式の確定足で差し替える（BarBoundaryWatchdog 用）。
   *
   * WS 切断中に古い tick で確定した足を、公式 klines の確定足で正す。
   * 形成中の足には触らない（次の tick が正しく組み直す）。
   *
   * 「確定足は形成中足より時間的に前」という足組立の不変条件を守るため、
   * 別時間足の足・形成中足を追い越す足は受け付けない。
   */
  reconcileLastConfirmed(official: ConfirmedCandle): void {
    if (official.timeFrame !== this._timeFrame) {
      throw new Error(
        `reconcileLastConfirmed: 別時間足の足は受け付けません: ${official.timeFrame}`,
      );
    }
    if (this._forming !== null) {
      // 足の同一性は足境界の始端（openTime）で判定する。closeTime は生成規約
      // （+duration / +duration-1）で 1ms 揺れるため境界判定に使わない。
      // 確定足の openTime が形成中足の openTime 以上なら、それは形成中足そのもの
      // か未来の足であり、確定足として受け付けられない。
      const officialOpenMs = official.openTime.toDate().getTime();
      const formingOpenMs = this._forming.openTime().toDate().getTime();
      if (officialOpenMs >= formingOpenMs) {
        throw new Error(
          'reconcileLastConfirmed: 公式確定足が形成中足の足境界に踏み込んでいます',
        );
      }
    }
    this._lastConfirmed = official;
  }
}
