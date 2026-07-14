import type { Price } from '../market/Price.js';

export interface ExtremesSnapshot {
  readonly highest: Price;
  readonly lowest: Price;
}
