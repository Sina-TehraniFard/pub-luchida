import { CurrencyPair } from './CurrencyPair.js';
import { LIVE_TIMEFRAMES, TimeFrame } from './TimeFrame.js';
import { Timestamp } from './Timestamp.js';
import { Tick } from './tick/Tick.js';
import { CandleEvent } from './candle/CandleEvent.js';
import { CandleAccumulator } from './candle/CandleAccumulator.js';
import { ConfirmedCandle } from './candle/ConfirmedCandle.js';
import { IndicatorConfig } from './indicator/IndicatorConfig.js';
import { IndicatorLedger } from './indicator/IndicatorLedger.js';
import { BarReconciled } from './indicator/BarReconciled.js';
import { SmaCalculatorFactory } from './indicator/SmaCalculator.js';
import { MarketSnapshot } from './snapshot/MarketSnapshot.js';
import { TimeFrameSnapshot } from './snapshot/TimeFrameSnapshot.js';
import { label as tfLabel } from './TimeFrame.js';
import type { LogPort } from '../port/LogPort.js';
import { NoopLogPort } from '../port/NoopLogPort.js';

/** 時間足ごとの足組立・指標計算の作業単位 */
interface TimeFrameEntry {
  readonly timeFrame: TimeFrame;
  readonly accumulator: CandleAccumulator;
  readonly ledger: IndicatorLedger;
}

/**
 * 複数の時間足をまとめて管理する帳簿。
 *
 * - LIVE_TIMEFRAMES（固定の時間足セット）を保持する
 * - tick を受け取り、全時間足の足・指標を更新して MarketSnapshot を返す
 * - 各時間足の詳細（足の組立・SMA計算）は CandleAccumulator / IndicatorLedger に任せる
 *
 * 使い方:
 *   1. warmUp(timeFrame, confirmedCandles) — 各時間足の初期化
 *   2. onTick(tick) — tick ごとに呼ぶ → MarketSnapshot が返る
 *
 * @note warmUp を全時間足に対して行った後でなければ onTick() は呼べない
 */
export class TimeFrameBook {
  private readonly logger: LogPort;
  private readonly _entries: ReadonlyMap<TimeFrame, TimeFrameEntry>;
  private readonly _pair: CurrencyPair;
  private readonly _config: IndicatorConfig;

  constructor(
    pair: CurrencyPair,
    config: IndicatorConfig,
    factory: SmaCalculatorFactory,
    logger: LogPort = NoopLogPort,
  ) {
    this._pair = pair;
    this._config = config;
    this.logger = logger;
    const entries = new Map<TimeFrame, TimeFrameEntry>();
    for (const tf of LIVE_TIMEFRAMES) {
      entries.set(tf, {
        timeFrame: tf,
        accumulator: new CandleAccumulator(tf),
        ledger: new IndicatorLedger(config.shortSmaPeriod, config.longSmaPeriod, factory),
      });
    }
    this._entries = entries;
  }

  /**
   * 指定した時間足の過去の確定足で SMA を初期化する。
   * longPeriod + 1 本以上の確定足が必要。
   */
  warmUp(timeFrame: TimeFrame, confirmedCandles: ConfirmedCandle[]): void {
    if (confirmedCandles.length === 0) {
      throw new Error(`TimeFrameBook: warmUp に空の配列が渡されました: ${timeFrame}`);
    }
    if (confirmedCandles.some((c) => c.timeFrame !== timeFrame)) {
      throw new Error(`TimeFrameBook: warmUp に別時間足の足が混入しています: ${timeFrame}`);
    }
    assertAscendingByOpenTime(confirmedCandles, 'warmUp', timeFrame);
    const entry = this.getEntry(timeFrame);
    entry.ledger.warmUp(confirmedCandles);
    entry.accumulator.seedHistory(confirmedCandles);
  }

  /**
   * tick を受け取り、全時間足の足・指標を更新して MarketSnapshot を返す。
   * 各時間足の warmUp() を完了してから呼ぶこと。
   */
  onTick(tick: Tick): MarketSnapshot {
    const timeFrames = new Map<TimeFrame, TimeFrameSnapshot>();

    for (const entry of this._entries.values()) {
      const snapshot = this.processEntry(entry, tick);
      timeFrames.set(entry.timeFrame, snapshot);
    }

    return MarketSnapshot.of({
      timeFrames,
      tick,
      pair: this._pair,
      capturedAt: Timestamp.now(),
    });
  }

  /**
   * 指定時間足を公式の確定足列で照合・訂正する（BarBoundaryWatchdog の唯一のドメイン入口）。
   *
   * 自前で組んだ確定足・SMA が GMO 公式 klines とズレていたら公式値で正す。
   * - ledger.reconcileWith: 確定 SMA を丸ごと再構築
   * - accumulator.reconcileLastConfirmed: 直近確定足を公式値に差し替え
   *
   * @returns 是正が起きたときだけ BarReconciled（ログ発火源）。差分が無ければ null。
   *          公式足が SMA 再構築に足りないときも null（= 照合不能。差分なしとは別事由）
   */
  reconcile(timeFrame: TimeFrame, official: ConfirmedCandle[]): BarReconciled | null {
    if (official.length === 0) {
      throw new Error(`TimeFrameBook: reconcile に空の配列が渡されました: ${timeFrame}`);
    }
    if (official.some((c) => c.timeFrame !== timeFrame)) {
      throw new Error(`TimeFrameBook: reconcile に別時間足の足が混入しています: ${timeFrame}`);
    }
    assertAscendingByOpenTime(official, 'reconcile', timeFrame);

    const entry = this.getEntry(timeFrame);

    // 本数不足は「公式データが照合の前提を満たさない＝照合不能」。足も SMA も触らず
    // スキップする。ここで触ると確定足だけ差し替わり SMA が未安定化して、次の
    // onTick → currentValues() が例外になる（足と SMA の不整合）。
    // NOTE: ここで返す null は「差分なし」ではなく「照合不能」。戻り値型は両者を
    //       区別しないため、その判断をこのコメントに明示して割り切る。
    if (official.length < entry.ledger.requiredBarsForStable()) {
      this.logger.warn(
        `${tfLabel(timeFrame)}: 公式足が SMA 再構築に不足。照合をスキップ`,
        { timeFrame, fetched: official.length, required: entry.ledger.requiredBarsForStable() },
      );
      return null;
    }

    // 足が真、SMA はその従属。確定足（純粋な代入）を先に正し、SMA をその後に再構築する。
    // 万一 SMA 再構築が throw しても、確定足は正しい値に揃っている。
    entry.accumulator.reconcileLastConfirmed(official[official.length - 1]);
    const { before, after, corrected } = entry.ledger.reconcileWith(official);

    if (!corrected || after === null) {
      return null;
    }
    return new BarReconciled(timeFrame, Timestamp.now(), before, after);
  }

  private processEntry(entry: TimeFrameEntry, tick: Tick): TimeFrameSnapshot {
    const { accumulator, ledger } = entry;
    const event: CandleEvent = accumulator.accumulate(tick);

    if (event.type === 'CONFIRMED') {
      // 足が確定: confirmedCandle を指標台帳に追加、次の足の更新も登録
      const confirmed = accumulator.lastConfirmed()!;
      ledger.onCandleConfirmed(confirmed);

      // 判断証跡: 確定 SMA は足確定時にしか変わらないため、ここが
      // 「ボットが判断に使う実値」を 1 足につき正確に 1 回記録できる唯一の場所。
      // EntryRule 側でログするとフィルタ短絡で歯抜けになる（偽クロス調査 #65 の教訓）。
      const sma = ledger.snapshotOrNull();
      const smaLabel = sma === null
        ? ''
        : ` SMA(${this._config.shortSmaPeriod})=${sma.shortSma.toString()} SMA(${this._config.longSmaPeriod})=${sma.longSma.toString()}`;
      this.logger.info(
        `${tfLabel(entry.timeFrame)}確定 C=${confirmed.close.toString()} H=${confirmed.high.toString()} L=${confirmed.low.toString()}${smaLabel}`,
        {
          timeFrame: entry.timeFrame,
          openTime: confirmed.openTime.toDate().toISOString(),
          close: confirmed.close.toString(),
          high: confirmed.high.toString(),
          low: confirmed.low.toString(),
          open: confirmed.open.toString(),
          ...(sma !== null
            ? {
                smaShort: sma.shortSma.toString(),
                smaLong: sma.longSma.toString(),
                prevSmaShort: sma.previousShortSma.toString(),
                prevSmaLong: sma.previousLongSma.toString(),
              }
            : {}),
        },
      );
      const forming = accumulator.currentForming()!;
      ledger.onCandleUpdated(forming);
    } else {
      // 足を更新: forming close を指標台帳で仮計算
      const forming = accumulator.currentForming()!;
      ledger.onCandleUpdated(forming);
    }

    const confirmedCandle = accumulator.lastConfirmed();
    const formingCandle = accumulator.currentForming();

    if (confirmedCandle === null || formingCandle === null) {
      throw new Error(
        `TimeFrameBook: ${entry.timeFrame} の足がまだ揃っていません。` +
          '最初の足確定後に onTick() を呼んでください。',
      );
    }

    return TimeFrameSnapshot.of({
      timeFrame: entry.timeFrame,
      confirmed: confirmedCandle,
      forming: formingCandle,
      indicators: ledger.currentValues(),
    });
  }

  private getEntry(timeFrame: TimeFrame): TimeFrameEntry {
    const entry = this._entries.get(timeFrame);
    if (entry === undefined) {
      throw new Error(`TimeFrameBook: 未知の TimeFrame: ${timeFrame}`);
    }
    return entry;
  }
}

/**
 * 確定足列が openTime の昇順（厳密増加）であることを保証する。
 *
 * SMA は移動窓であり列の順序がそのまま時系列。順序が狂うと SMA が沈黙して
 * 誤った値を出す。「確定足列は時刻昇順」はドメインの不変条件であり、Adapter が
 * 並べてくれている偶然に頼らず入口で自衛する（ブローカー非依存設計のため）。
 */
function assertAscendingByOpenTime(
  candles: ConfirmedCandle[],
  context: string,
  timeFrame: TimeFrame,
): void {
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].openTime.toDate().getTime();
    const curr = candles[i].openTime.toDate().getTime();
    if (curr <= prev) {
      throw new Error(
        `TimeFrameBook: ${context} の確定足が openTime 昇順になっていません: ${timeFrame}`,
      );
    }
  }
}
