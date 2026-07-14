import Big from 'big.js';
import { currencyPairEquals, type CurrencyPair } from './CurrencyPair.js';
import { Pips } from './Pips.js';

/**
 * 通貨ペアの現在レートを表す値オブジェクト。
 *
 * 取得失敗時は null を返さず、RatePort 側で例外を送出する。
 * 内部表現は `Big`（精度保持）+ `CurrencyPair`（ペア整合）+ `number`（epoch ms。鮮度判定用キャプチャ時刻）。
 *
 * `Date` はミュータブルなため、内部では epoch ms（`number`）として保持し、
 * `capturedAt()` で都度新しい `Date` を返すことで防御的コピーを実現する。
 *
 * フィールド名は `pairValue` / `capturedAtMillis` とし、ゲッターと衝突しないようにする
 * （Money の `currency` フィールド + `currencyCode()` ゲッターと同じ命名規約）。
 *
 * 制約: `value > 0`、生成後は変更不可。
 */
export class Rate {
  private constructor(
    private readonly value: Big,
    private readonly pairValue: CurrencyPair,
    private readonly capturedAtMillis: number,
  ) {}

  static of(value: number | string, pair: CurrencyPair, capturedAt: Date): Rate {
    const v = new Big(value);
    if (v.lte(0)) {
      throw new Error(`Rate は正の数: ${value}`);
    }
    return new Rate(v, pair, capturedAt.getTime());
  }

  /** @internal */
  toBig(): Big {
    return this.value;
  }

  pair(): CurrencyPair {
    return this.pairValue;
  }

  capturedAt(): Date {
    return new Date(this.capturedAtMillis);
  }

  pipDifference(other: Rate): Pips {
    if (!currencyPairEquals(this.pairValue, other.pairValue)) {
      throw new Error(`Rate の通貨ペアが一致しません: ${this.pairValue} vs ${other.pairValue}`);
    }
    const diff = this.value.minus(other.value);
    return Pips.of(diff.toFixed());
  }

  isFreshEnough(now: Date, maxAgeMillis: number): boolean {
    return now.getTime() - this.capturedAtMillis <= maxAgeMillis;
  }

  equals(other: Rate): boolean {
    return currencyPairEquals(this.pairValue, other.pairValue)
      && this.value.eq(other.value)
      && this.capturedAtMillis === other.capturedAtMillis;
  }
}
