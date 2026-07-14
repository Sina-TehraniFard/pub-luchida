import { Price } from './Price.js';
import { Timestamp } from './Timestamp.js';
import { Pips } from './Pips.js';

export class ExitResult {
  private constructor(
    readonly exitPrice: Price,
    readonly executedAt: Timestamp,
    readonly profitLoss: Pips,
  ) {}

  static of(params: {
    exitPrice: Price;
    executedAt: Timestamp;
    profitLoss: Pips;
  }): ExitResult {
    return new ExitResult(params.exitPrice, params.executedAt, params.profitLoss);
  }
}
