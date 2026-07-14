import { PositionId } from '../position/PositionId.js';
import { Price } from './Price.js';
import { Timestamp } from './Timestamp.js';

export class EntryResult {
  private constructor(
    readonly positionId: PositionId,
    readonly entryPrice: Price,
    readonly executedAt: Timestamp,
  ) {}

  static of(params: {
    positionId: PositionId;
    entryPrice: Price;
    executedAt: Timestamp;
  }): EntryResult {
    return new EntryResult(params.positionId, params.entryPrice, params.executedAt);
  }
}
