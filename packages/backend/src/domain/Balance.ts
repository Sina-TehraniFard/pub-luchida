import { Money } from './Money.js';
import { Ratio } from './Ratio.js';

/**
 * 口座の残高を表す値オブジェクト。
 *
 * 内部表現は `Money`（金額+通貨）。残高は性質上必ず非負であるべきため、
 * 生成時および減算後に `amount >= 0` を強制する。
 * 生成後は変更不可（イミュータブル）。
 *
 * 設計書: docs/design/value-objects.md L839-890。
 */
export class Balance {
  private constructor(private readonly money: Money) {}

  static of(money: Money): Balance {
    if (money.isNegative()) {
      throw new Error(`Balance は非負: ${money.toString()}`);
    }
    return new Balance(money);
  }

  /** 残高に比率を掛けた金額を Money として返す（戻り値は Balance ではない点に注意） */
  multipliedBy(ratio: Ratio): Money {
    return this.money.times(ratio);
  }

  minus(other: Money): Balance {
    const next = this.money.minus(other);
    if (next.isNegative()) {
      throw new Error(
        `Balance を差し引くと負になります: ${this.money.toString()} - ${other.toString()}`,
      );
    }
    return new Balance(next);
  }

  isZero(): boolean {
    return this.money.isZero();
  }

  toMoney(): Money {
    return this.money;
  }

  equals(other: Balance): boolean {
    return this.money.equals(other.money);
  }

  toString(): string {
    return this.money.toString();
  }
}
