import { Pips } from './Pips.js';
import { Price } from './Price.js';

export class Spread {
  private constructor(
    private readonly _ask: Price,
    private readonly _bid: Price,
  ) {}

  static of(ask: Price, bid: Price): Spread {
    const diff = ask.toBig().minus(bid.toBig());
    if (diff.lte(0)) {
      throw new Error(`スプレッドは正の数: ask=${ask}, bid=${bid}`);
    }
    return new Spread(ask, bid);
  }

  get ask(): Price {
    return this._ask;
  }

  get bid(): Price {
    return this._bid;
  }

  value(): Pips {
    const diff = this._ask.toBig().minus(this._bid.toBig());
    return Pips.of(diff.toFixed());
  }

  equals(other: Spread): boolean {
    return this._ask.equals(other._ask) && this._bid.equals(other._bid);
  }

  toString(): string {
    return `Spread(ask=${this._ask}, bid=${this._bid}, value=${this.value()})`;
  }
}
