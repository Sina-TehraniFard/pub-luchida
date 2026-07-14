import { ConfirmedCandle } from '../candle/ConfirmedCandle.js';
import { FormingCandle } from '../candle/FormingCandle.js';
import { IndicatorValues } from './IndicatorValues.js';
import { SmaCalculator, SmaCalculatorFactory } from './SmaCalculator.js';
import { SmaSnapshot } from './SmaSnapshot.js';
import { SmaValue } from './SmaValue.js';

/**
 * 1本のSMAラインの確定値・形成中仮値を追跡する。
 * IndicatorLedger の内部実装詳細。
 */
class SmaTracker {
  private _confirmed: SmaCalculator;
  private _forming: SmaCalculator;

  private _current: number | null = null;
  private _prev: number | null = null;
  private _formingCurrent: number | null = null;
  private _hasFormingValue: boolean = false;

  constructor(
    private readonly _period: number,
    private readonly _factory: SmaCalculatorFactory,
  ) {
    this._confirmed = _factory.create(_period);
    this._forming = _factory.create(_period);
  }

  /**
   * 公式 close 列で内部状態を作り直す（reconcile 用）。
   * SmaCalculator は reset を持たないため、新規生成して列を再投入する。
   * 確定 SMA を丸ごと再構築し、forming 仮値はクリアする。
   */
  reseed(closes: number[]): void {
    this._confirmed = this._factory.create(this._period);
    this._forming = this._factory.create(this._period);
    this._current = null;
    this._prev = null;
    this._formingCurrent = null;
    this._hasFormingValue = false;

    for (const close of closes) {
      this.addConfirmed(close); // 確定 SMA の前進ロジックを一元化（warmUp と同じ）
      this._forming.add(close);
    }
  }

  /** 確定足の close を追加し、SMA を更新する（warmUp / onCandleConfirmed 共通） */
  addConfirmed(close: number): void {
    this._prev = this._current;
    this._confirmed.add(close);
    if (this._confirmed.isStable()) {
      this._current = this._confirmed.getResult();
    }
  }

  /** warmUp 時: forming SMA にも同じ close を追加する（仮値フラグは立てない） */
  addFormingForWarmUp(close: number): void {
    this._forming.add(close);
  }

  /** 足確定時: forming SMA の仮値をリセットし、確定 close を基準にする */
  resetForming(confirmedClose: number): void {
    if (this._hasFormingValue) {
      this._forming.replace(confirmedClose);
    } else {
      this._forming.add(confirmedClose);
    }
    this._formingCurrent = null;
    this._hasFormingValue = false;
  }

  /** 形成中足の close で仮 SMA を更新する */
  updateForming(close: number): void {
    if (this._hasFormingValue) {
      this._forming.replace(close);
    } else {
      this._forming.add(close);
      this._hasFormingValue = true;
    }
    if (this._forming.isStable()) {
      this._formingCurrent = this._forming.getResult();
    }
  }

  get current(): number | null {
    return this._current;
  }

  get prev(): number | null {
    return this._prev;
  }

  get formingCurrent(): number | null {
    return this._formingCurrent;
  }

  get isStable(): boolean {
    return this._current !== null;
  }
}

/**
 * SMA を計算して記録する台帳。
 *
 * - 短期・長期の 2 本の SMA を管理する（ゴールデンクロス判定に使う）
 * - 確定足のSMA（confirmed）と形成中足込みのSMA（forming）を分けて保持する
 * - SMA の計算は SmaCalculator（Port）に委譲する
 *
 * confirmed SMA:
 *   確定足のclose価格だけで計算した SMA。current は最新確定後の値、previous はその1本前の値。
 *
 * forming SMA:
 *   確定足に加えて形成中足の current close を仮値として加えた SMA。
 *   current は仮値込みの SMA、previous は確定済み SMA（= confirmed.current）。
 */
export class IndicatorLedger {
  private readonly _short: SmaTracker;
  private readonly _long: SmaTracker;
  private readonly _requiredBarsForStable: number;

  constructor(
    shortPeriod: number,
    longPeriod: number,
    factory: SmaCalculatorFactory,
  ) {
    this._short = new SmaTracker(shortPeriod, factory);
    this._long = new SmaTracker(longPeriod, factory);
    // 両 SMA が安定するのに必要な確定足の本数（長い方の窓長）
    this._requiredBarsForStable = Math.max(shortPeriod, longPeriod);
  }

  /** 両 SMA が安定するのに必要な確定足の本数 */
  requiredBarsForStable(): number {
    return this._requiredBarsForStable;
  }

  /**
   * 過去の確定足でSMAを初期化する。
   * candleCount >= longPeriod + 1 が必要（前回値を保持するため）。
   */
  warmUp(confirmedCandles: ConfirmedCandle[]): void {
    for (const candle of confirmedCandles) {
      const close = candle.close.toBig().toNumber();
      this._short.addConfirmed(close);
      this._long.addConfirmed(close);
      this._short.addFormingForWarmUp(close);
      this._long.addFormingForWarmUp(close);
    }
  }

  /**
   * 足が確定したときに呼ぶ。
   * - 確定SMAを更新する
   * - forming SMA の仮値をリセットし、確定close を基準にする
   */
  onCandleConfirmed(confirmedCandle: ConfirmedCandle): void {
    const close = confirmedCandle.close.toBig().toNumber();
    this._short.addConfirmed(close);
    this._long.addConfirmed(close);
    this._short.resetForming(close);
    this._long.resetForming(close);
  }

  /**
   * 形成中足が更新されたときに呼ぶ。
   * - forming SMA の仮値を更新する（replace で上書き or 初回は add）
   */
  onCandleUpdated(formingCandle: FormingCandle): void {
    const close = formingCandle.currentClose().toBig().toNumber();
    this._short.updateForming(close);
    this._long.updateForming(close);
  }

  /**
   * 公式の確定足列で確定 SMA を丸ごと再構築する（BarBoundaryWatchdog 用）。
   *
   * warmUp（起動時の初期化）とは別概念。こちらは稼働中に、自前で組んだ足が
   * 公式 klines とズレていたとき、公式値を正として SMA を作り直す「照合・訂正」。
   *
   * 移動窓なので窓内の1本でも変われば SMA 値が変わる。部分補正は変化点追跡の
   * 複雑さを生むだけなので、列を丸ごと再投入する。
   *
   * @returns before（補正前 SMA）/ after（補正後 SMA）/ corrected（差分があったか）。
   *          SMA がまだ安定していない場合は該当 snapshot を null で返す。
   */
  reconcileWith(officialCandles: ConfirmedCandle[]): {
    before: SmaSnapshot | null;
    after: SmaSnapshot | null;
    corrected: boolean;
  } {
    const before = this.snapshotOrNull();

    const closes = officialCandles.map((c) => c.close.toBig().toNumber());
    this._short.reseed(closes);
    this._long.reseed(closes);

    const after = this.snapshotOrNull();

    return { before, after, corrected: !snapshotEquals(before, after) };
  }

  /**
   * 確定 SMA の snapshot を返す（未安定なら null）。
   * 足確定時の判断証跡ログ（TimeFrameBook）等、読み取り専用の用途に使う。
   */
  snapshotOrNull(): SmaSnapshot | null {
    if (!this._short.isStable || !this._long.isStable) {
      return null;
    }
    return this.buildConfirmedSnapshot();
  }

  /**
   * 現在の IndicatorValues を返す。
   * warmUp() でSMAが安定する前に呼ぶと Error をスローする。
   */
  currentValues(): IndicatorValues {
    if (!this._short.isStable || !this._long.isStable) {
      throw new Error(
        'IndicatorLedger: SMA がまだ安定していません。warmUp() に十分な確定足を渡してください。',
      );
    }
    return IndicatorValues.of(this.buildConfirmedSnapshot(), this.buildFormingSnapshot());
  }

  private buildConfirmedSnapshot(): SmaSnapshot {
    const sc = this._short.current!;
    const sp = this._short.prev ?? sc;
    const lc = this._long.current!;
    const lp = this._long.prev ?? lc;

    return SmaSnapshot.of({
      shortSma: SmaValue.of(String(sc)),
      longSma: SmaValue.of(String(lc)),
      previousShortSma: SmaValue.of(String(sp)),
      previousLongSma: SmaValue.of(String(lp)),
    });
  }

  private buildFormingSnapshot(): SmaSnapshot {
    const sc = this._short.current!;
    const lc = this._long.current!;
    const sfc = this._short.formingCurrent ?? sc;
    const lfc = this._long.formingCurrent ?? lc;

    return SmaSnapshot.of({
      shortSma: SmaValue.of(String(sfc)),
      longSma: SmaValue.of(String(lfc)),
      previousShortSma: SmaValue.of(String(sc)),
      previousLongSma: SmaValue.of(String(lc)),
    });
  }
}

/** null を許容する SmaSnapshot の等価判定（reconcile の差分検出用） */
function snapshotEquals(a: SmaSnapshot | null, b: SmaSnapshot | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.equals(b);
}
