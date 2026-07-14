import { Price } from '../Price.js';
import { Spread } from '../Spread.js';
import { TickTimestamp } from './TickTimestamp.js';

export class Tick {
  private constructor(
    private readonly _ask: Price,
    private readonly _bid: Price,
    private readonly _timestamp: TickTimestamp,
  ) {}

  static of(ask: Price, bid: Price, timestamp: TickTimestamp): Tick {
    if (!ask.isHigherThan(bid)) {
      throw new Error(
        `Tick: ask は bid より大きくなければなりません: ask=${ask}, bid=${bid}`,
      );
    }
    return new Tick(ask, bid, timestamp);
  }

  ask(): Price {
    return this._ask;
  }

  bid(): Price {
    return this._bid;
  }

  timestamp(): TickTimestamp {
    return this._timestamp;
  }

  spread(): Spread {
    return Spread.of(this._ask, this._bid);
  }

  midPrice(): Price {
    return this._ask.midBetween(this._bid);
  }

  equals(other: Tick): boolean {
    return (
      this._ask.equals(other.ask()) &&
      this._bid.equals(other.bid()) &&
      this._timestamp.equals(other.timestamp())
    );
  }
}
