import { durationMs } from '@luchida/backend/domain/market/TimeFrame.js';
import type { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import type { TimeFrameIndicatorSpec } from '@luchida/backend/domain/market/indicator/TimeFrameIndicatorSpec.js';

/**
 * 複数 timeframe のインジケーターを安定させるために必要な warmup 要件。
 *
 * 各 timeframe ごとに longPeriod 本の確定足が必要。
 * BT 全体の開始時刻は、最も多くの過去データを必要とする timeframe に合わせて遡る。
 *
 * 例: 15分足 longPeriod=100 (=25h) と 1h longPeriod=100 (=100h) の両方を使う場合、
 *     dateFrom より 100h 前から fetch を開始する必要がある（1h 側に合わせる）。
 *
 * 純粋な値オブジェクト。テスト容易性のため副作用を持たない。
 */
export class WarmupRequirement {
  private constructor(private readonly specs: ReadonlyArray<TimeFrameIndicatorSpec>) {}

  static forSpecs(specs: ReadonlyArray<TimeFrameIndicatorSpec>): WarmupRequirement {
    if (specs.length === 0) {
      throw new Error('WarmupRequirement: specs は 1 つ以上必要');
    }
    const seen = new Set<TimeFrame>();
    for (const s of specs) {
      if (seen.has(s.timeFrame)) {
        throw new Error(`WarmupRequirement: timeFrame が重複: ${s.timeFrame}`);
      }
      seen.add(s.timeFrame);
    }
    return new WarmupRequirement(specs);
  }

  /** 指定 timeframe の warmup に必要な確定足数（longPeriod 本） */
  warmupCountFor(timeFrame: TimeFrame): number {
    const spec = this.specs.find(s => s.timeFrame === timeFrame);
    if (!spec) {
      throw new Error(`WarmupRequirement: timeFrame は specs に含まれていない: ${timeFrame}`);
    }
    return spec.longPeriod;
  }

  /**
   * 全 timeframe の warmup が揃う最も古い時刻。
   * 各 timeframe について「longPeriod 本ぶんの過去データ」が必要なので、
   * その中で最も長い遡及時間を選ぶ。
   */
  earliestStartTime(dateFrom: Date): Date {
    let maxOffsetMs = 0;
    for (const spec of this.specs) {
      const offset = spec.longPeriod * durationMs(spec.timeFrame);
      if (offset > maxOffsetMs) maxOffsetMs = offset;
    }
    return new Date(dateFrom.getTime() - maxOffsetMs);
  }
}
