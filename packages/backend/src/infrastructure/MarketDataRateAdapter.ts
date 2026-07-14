import type { MarketDataPort } from '../port/MarketDataPort.js';
import type { RatePort } from '../port/RatePort.js';
import type { Clock } from '../port/Clock.js';
import type { Tick } from '../domain/market/tick/Tick.js';
import { Rate } from '../domain/market/Rate.js';
import { currencyPairEquals, type CurrencyPair } from '../domain/market/CurrencyPair.js';
import { RatePortError } from '../domain/error/RatePortError.js';
import { Logger } from './logging/Logger.js';

/**
 * `MarketDataPort.subscribe` を listener として購読する Tick-driven `RatePort` 実装。
 *
 * 1 つの通貨ペアにバインドし、最新 Tick から bid 価格を `Rate` に変換して返す。
 * `MarketDataStreamPort`（ライフサイクル契約）に最新値クエリを混ぜないため、
 * Rate 取得経路は本 Adapter が独立して担う（policies.md 4.4 P6 増田亨判定）。
 *
 *   - `currentOf(pair)`: 鮮度非保証。初回 tick 未到着時は null
 *   - `currentFresh(pair)`: 鮮度保証。未到着・鮮度切れは `RatePortError` で throw
 *
 * 鮮度閾値（`maxAgeMillis`）と現在時刻取得（`Clock`）はコンストラクタ注入で、
 * Adapter 内のマジックナンバーを排除する。
 *
 * 設計書: docs/design/position-manager/policies.md 4.4 P6。
 */
export class MarketDataRateAdapter implements RatePort {
  private readonly logger = new Logger('MarketDataRateAdapter', 'MARKET');
  private latest: Rate | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly marketDataPort: MarketDataPort,
    private readonly pair: CurrencyPair,
    private readonly clock: Clock,
    private readonly maxAgeMillis: number,
  ) {}

  /** `MarketDataPort.subscribe` に listener を登録する。冪等。 */
  start(): void {
    if (this.unsubscribe !== null) {
      return;
    }
    this.unsubscribe = this.marketDataPort.subscribe((tick: Tick) => {
      const isFirst = this.latest === null;
      this.latest = Rate.of(
        tick.bid().toBig().toFixed(),
        this.pair,
        tick.timestamp().toDate(),
      );
      if (isFirst) {
        this.logger.info('初回 tick 受信', { pair: this.pair });
      }
    });
  }

  /** 購読を解除する。テストや shutdown で利用。 */
  stop(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  currentOf(pair: CurrencyPair): Rate | null {
    this.assertSamePair(pair);
    return this.latest;
  }

  currentFresh(pair: CurrencyPair): Rate {
    this.assertSamePair(pair);
    if (this.latest === null) {
      throw RatePortError.notYetAvailable(pair);
    }
    const now = this.clock.now();
    if (!this.latest.isFreshEnough(now, this.maxAgeMillis)) {
      const ageMillis = now.getTime() - this.latest.capturedAt().getTime();
      this.logger.warn('Rate 鮮度切れ', { pair, ageMillis, maxAgeMillis: this.maxAgeMillis });
      throw RatePortError.stale(pair, ageMillis, this.maxAgeMillis);
    }
    return this.latest;
  }

  private assertSamePair(pair: CurrencyPair): void {
    if (!currencyPairEquals(pair, this.pair)) {
      throw RatePortError.pairMismatch(this.pair, pair);
    }
  }
}
