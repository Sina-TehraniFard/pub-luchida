import type { Server as SocketIOServer } from 'socket.io';
import Big from 'big.js';
import type { EntryDecisionObserverPort } from '../../port/EntryDecisionObserverPort.js';
import type { MarketSnapshot } from '../../domain/market/snapshot/MarketSnapshot.js';
import { TimeFrame } from '../../domain/market/TimeFrame.js';
import { pipUnit } from '../../domain/market/CurrencyPair.js';
import { detectCross } from '../../domain/rule/sma-cross/SmaCrossSignal.js';
import type { TimeWindow } from '../../domain/rule/shared/TimeWindowBlockEntryRule.js';

interface FilterStep {
  name: string;
  passed: boolean;
  detail: string;
}

interface ObserverConfig {
  timeFrame: TimeFrame;
  minCrossStrengthPips: number;
  maxDirectionalDivergencePct: number;
  minSellPrice: number | null;
  excludeHoursUtc: ReadonlySet<number>;
  blockedWindows: readonly TimeWindow[];
}

/**
 * エントリー判定を本番フィルタと同じ閾値で再現し、GC/DC 検知と各フィルタの
 * 通過/却下を 1 イベント（entry:decision）として UI に流す観測器（繋ぎ用）。
 *
 * 本番の EntryRule デコレータ群には干渉しない。閾値は Composition Root から
 * 同じ値を受け取り、判定だけ並走させる。フロントエンド撤去までの暫定。
 */
export class SocketEntryDecisionObserver implements EntryDecisionObserverPort {
  constructor(
    private readonly io: SocketIOServer,
    private readonly config: ObserverConfig,
  ) {}

  observe(snapshot: MarketSnapshot): void {
    const tf = snapshot.snapshotOf(this.config.timeFrame);
    const sma = tf.indicators.confirmed;
    const cross = detectCross(sma);

    const short = new Big(sma.shortSma.toString());
    const long = new Big(sma.longSma.toString());
    const diff = short.minus(long);

    // クロスが無い足は emit しない（ログ過多を避ける）
    if (cross === 'NONE') return;

    const buySell = cross === 'GOLDEN_CROSS' ? 'BUY' : 'SELL';
    const unit = pipUnit(snapshot.pair);
    const bid = new Big(snapshot.tick.bid().toString());
    const ask = new Big(snapshot.tick.ask().toString());
    const mid = bid.plus(ask).div(2);
    const capturedAt = snapshot.capturedAt.toDate();

    const steps: FilterStep[] = [];

    // 1) 時間帯フィルタ（UTC hour 除外）
    const hour = capturedAt.getUTCHours();
    const timeOk = !this.config.excludeHoursUtc.has(hour);
    steps.push({
      name: '時間帯フィルタ',
      passed: timeOk,
      detail: `UTC ${hour}時${timeOk ? '' : '（除外時間帯）'}`,
    });

    // 2) 中旬JST昼（非BOJ日）窓ブロック
    const blockedBy = this.config.blockedWindows.find((w) => w.matches(capturedAt));
    steps.push({
      name: '時間窓ブロック',
      passed: blockedBy === undefined,
      detail: blockedBy ? `ブロック窓: ${blockedBy.label}` : '該当窓なし',
    });

    // 3) 価格帯フィルタ（SELL は mid < minSellPrice で block）
    const priceBandOk =
      buySell === 'BUY' ||
      this.config.minSellPrice === null ||
      mid.gte(this.config.minSellPrice);
    steps.push({
      name: '価格帯フィルタ',
      passed: priceBandOk,
      detail:
        buySell === 'SELL' && this.config.minSellPrice !== null
          ? `mid=${mid.toFixed(3)} 閾値=${this.config.minSellPrice}`
          : '対象外（BUY）',
    });

    // 4) SMA順方向乖離フィルタ（順方向に maxDivergencePct 超え乖離なら block）
    const fwdDiff = buySell === 'BUY' ? bid.minus(short) : short.minus(bid);
    const divergencePct = fwdDiff.div(short).times(100).toNumber();
    const divergenceOk = divergencePct <= this.config.maxDirectionalDivergencePct;
    steps.push({
      name: 'SMA順方向乖離フィルタ',
      passed: divergenceOk,
      detail: `乖離=${divergencePct.toFixed(4)}% 閾値=${this.config.maxDirectionalDivergencePct}%`,
    });

    // 5) クロス強度フィルタ（1barの乖離変化量が minStrengthPips 未満なら block）
    const prevShort = new Big(sma.previousShortSma.toString());
    const prevLong = new Big(sma.previousLongSma.toString());
    const strength = short
      .minus(long)
      .minus(prevShort.minus(prevLong))
      .abs()
      .div(unit)
      .toNumber();
    const strengthOk = strength >= this.config.minCrossStrengthPips;
    steps.push({
      name: 'クロス強度フィルタ',
      passed: strengthOk,
      detail: `強度=${strength.toFixed(4)}pips 閾値=${this.config.minCrossStrengthPips}pips`,
    });

    const rejectedAt = steps.find((s) => !s.passed);

    this.io.emit('entry:decision', {
      time: capturedAt.toISOString(),
      cross,
      buySell,
      sma20: short.toFixed(4),
      sma100: long.toFixed(4),
      diff: diff.toFixed(4),
      bid: bid.toFixed(3),
      entered: rejectedAt === undefined,
      rejectedBy: rejectedAt ? rejectedAt.name : null,
      steps,
    });
  }
}
