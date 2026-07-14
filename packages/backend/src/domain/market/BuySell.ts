export const BuySell = {
  BUY: 'BUY',
  SELL: 'SELL',
} as const;

export type BuySell = (typeof BuySell)[keyof typeof BuySell];

export function opposite(side: BuySell): BuySell {
  return side === BuySell.BUY ? BuySell.SELL : BuySell.BUY;
}
