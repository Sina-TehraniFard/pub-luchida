import { SmaSnapshot } from '../../market/indicator/SmaSnapshot.js';

export type CrossType = 'GOLDEN_CROSS' | 'DEAD_CROSS' | 'NONE';

export function detectCross(sma: SmaSnapshot): CrossType {
  const isGoldenCross =
    (sma.previousShortSma.isBelow(sma.previousLongSma) || sma.previousShortSma.equals(sma.previousLongSma)) &&
    sma.shortSma.isAbove(sma.longSma);
  if (isGoldenCross) return 'GOLDEN_CROSS';

  const isDeadCross =
    (sma.previousShortSma.isAbove(sma.previousLongSma) || sma.previousShortSma.equals(sma.previousLongSma)) &&
    sma.shortSma.isBelow(sma.longSma);
  if (isDeadCross) return 'DEAD_CROSS';

  return 'NONE';
}
