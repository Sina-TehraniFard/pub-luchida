import type { CandleHistoryPort } from '../../port/CandleHistoryPort.js';
import { ConfirmedCandle } from '../../domain/market/candle/ConfirmedCandle.js';
import { Price } from '../../domain/market/Price.js';
import { CandleOpenTime } from '../../domain/market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '../../domain/market/candle/CandleCloseTime.js';
import { TimeFrame, durationMs, label as tfLabel } from '../../domain/market/TimeFrame.js';
import { CurrencyPair } from '../../domain/market/CurrencyPair.js';
import { MarketDataError } from '../../domain/error/MarketDataError.js';
import type { GmoRestClient } from './GmoRestClient.js';
import type { Clock } from '../../port/Clock.js';
import { Logger } from '../../infrastructure/logging/Logger.js';

/**
 * CandleHistoryPort の実装。
 * GMO FX の Public REST API（klines）から過去のローソク足を取得する。
 *
 * GMO の klines は末尾に「現在進行中の未確定足」を含めて返す。本ポートの契約は
 * 確定足（ConfirmedCandle）の列を返すことなので、closeTime がまだ未来の足は
 * 取り除く。これがないと warmUp・reconcile が未確定足を確定足として扱い、
 * SMA や確定足を汚染する。確定判定のため Clock（現在時刻）を注入する。
 */
export class GmoCandleHistoryAdapter implements CandleHistoryPort {
  private readonly logger = new Logger('GmoCandleHistoryAdapter', 'MARKET');

  /**
   * @param pair 取得対象の通貨ペア。ライブ運用は USD_JPY 固定のため既定値とする。
   *   全ペア参照のような用途では明示的に渡す（金銭経路の呼び出しは既定のまま）。
   */
  constructor(
    private readonly restClient: GmoRestClient,
    private readonly clock: Clock,
    private readonly pair: CurrencyPair = CurrencyPair('USD_JPY'),
  ) {}

  async fetchRecent(
    timeFrame: TimeFrame,
    candleCount: number,
  ): Promise<ConfirmedCandle[]> {
    const interval = toGmoInterval(timeFrame);
    const dates = this.buildDateParams(timeFrame, candleCount);

    const allCandles: ConfirmedCandle[] = [];

    for (const date of dates) {
      try {
        const response = await this.restClient.publicGet<GmoKlineData[]>(
          '/public/v1/klines',
          {
            symbol: toGmoSymbol(this.pair),
            priceType: 'BID',
            interval,
            date,
          },
        );

        const candles = response.data.map((k) =>
          this.toConfirmedCandle(k, timeFrame),
        );
        allCandles.push(...candles);
      } catch (err) {
        if (err instanceof MarketDataError) throw err;
        this.logger.warn('klines 取得失敗。次の日付を試行', { date, error: String(err) });
      }
    }

    // GMO は末尾に現在進行中の未確定足を含める。closeTime が未来の足は確定して
    // いないので落とす（確定足だけ返すのがこのポートの契約）。
    const now = this.clock.now().getTime();
    const confirmed = allCandles.filter(
      (c) => c.closeTime.toDate().getTime() < now,
    );

    // 新しい順にソートして必要な本数を取得
    confirmed.sort(
      (a, b) => b.openTime.toDate().getTime() - a.openTime.toDate().getTime(),
    );
    const result = confirmed.slice(0, candleCount);

    // 古い順に戻す
    result.reverse();

    this.logger.info(`${this.pair} ${tfLabel(timeFrame)} ${result.length}本取得完了`, {
      pair: this.pair,
      timeFrame,
      requested: candleCount,
      fetched: result.length,
    });

    if (result.length === 0) {
      throw MarketDataError.fetchFailed(
        `ローソク足が0本: pair=${this.pair}, timeFrame=${timeFrame}`,
      );
    }

    return result;
  }

  /**
   * klines API の date パラメータを構築する。
   * 日足は YYYY 形式、それ以外は YYYYMMDD 形式。
   * 必要数が揃うよう過去の日付も含める。
   */
  private buildDateParams(timeFrame: TimeFrame, candleCount: number): string[] {
    const now = new Date();

    if (timeFrame === TimeFrame.ONE_DAY) {
      // 日足は年単位。今年と去年をカバー
      const year = now.getUTCFullYear();
      return [String(year), String(year - 1)];
    }

    // candleCount と時間足の長さから必要な日数を逆算（+7 日で土日・年末年始をカバー）
    const candlesPerDay = 86_400_000 / durationMs(timeFrame);
    const daysNeeded = Math.ceil(candleCount / candlesPerDay) + 7;

    const dates: string[] = [];
    for (let i = 0; i < daysNeeded; i++) {
      const d = new Date(now.getTime() - i * 86_400_000);
      dates.push(formatDate(d));
    }
    return dates;
  }

  private toConfirmedCandle(
    k: GmoKlineData,
    timeFrame: TimeFrame,
  ): ConfirmedCandle {
    const openTimeMs = Number(k.openTime);
    const openDate = new Date(openTimeMs);
    const closeDate = new Date(openTimeMs + durationMs(timeFrame) - 1);

    return ConfirmedCandle.of({
      open: Price.of(k.open),
      high: Price.of(k.high),
      low: Price.of(k.low),
      close: Price.of(k.close),
      openTime: CandleOpenTime.of(openDate),
      closeTime: CandleCloseTime.of(closeDate),
      timeFrame,
    });
  }
}

/**
 * ドメインの通貨ペア語彙（BASE_QUOTE）を GMO の symbol 表記へ変換する。
 *
 * 現状は GMO のシンボル表記がドメイン語彙と一致するため恒等変換だが、
 * 「ブローカー制約は Adapter 層が持つ」方針に従い、ドメイン語彙 → ブローカー表記の
 * 対応をこの 1 関数に局所化しておく。将来ブローカーごとに表記が割れた際は
 * ここだけを書き換える（toGmoInterval と同じ役割）。
 */
function toGmoSymbol(pair: CurrencyPair): string {
  return pair;
}

function toGmoInterval(timeFrame: TimeFrame): string {
  switch (timeFrame) {
    case TimeFrame.ONE_MINUTE:
      return '1min';
    case TimeFrame.FIFTEEN_MINUTE:
      return '15min';
    case TimeFrame.ONE_HOUR:
      return '1hour';
    case TimeFrame.ONE_DAY:
      return '1day';
  }
}

function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** GMO klines API のデータ型 */
interface GmoKlineData {
  openTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
}
