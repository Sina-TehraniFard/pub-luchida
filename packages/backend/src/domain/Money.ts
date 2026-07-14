import Big from 'big.js';
import type { Currency } from './market/Currency.js';
import { Ratio } from './Ratio.js';

/**
 * 金額と通貨をひとまとめにする値オブジェクト。
 *
 * 通貨が異なる `Money` どうしの加減算は型エラーではなく実行時エラーで弾く
 * （Currency が文字列リテラル union のため）。
 *
 * 値そのものは正負を許容する。差し引き結果が負になりうる中間値（評価損益など）で
 * そのまま使えるようにするためで、「絶対値」「正のみ」を保証したいケースは
 * 専用 VO（Pips など）を別途用意する方針。
 */
export class Money {
  private constructor(
    private readonly value: Big,
    private readonly currency: Currency,
  ) {}

  static of(value: number | string, currency: Currency): Money {
    return new Money(new Big(value), currency);
  }

  static jpy(value: number | string): Money {
    return Money.of(value, 'JPY');
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`通貨不一致: ${this.currency} vs ${other.currency}`);
    }
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  times(ratio: Ratio): Money {
    return new Money(this.value.times(ratio.toBig()), this.currency);
  }

  isNegative(): boolean {
    return this.value.lt(0);
  }

  isZero(): boolean {
    return this.value.eq(0);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.eq(other.value);
  }

  /** @internal */
  toBig(): Big {
    return this.value;
  }

  currencyCode(): Currency {
    return this.currency;
  }

  toString(): string {
    return `${this.value.toFixed()} ${this.currency}`;
  }
}
