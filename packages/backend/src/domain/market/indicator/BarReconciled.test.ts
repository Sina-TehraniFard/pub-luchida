import { describe, it, expect } from 'vitest';
import { TimeFrame } from '../TimeFrame.js';
import { Timestamp } from '../Timestamp.js';
import { SmaSnapshot } from './SmaSnapshot.js';
import { SmaValue } from './SmaValue.js';
import { BarReconciled } from './BarReconciled.js';

const snapshot = (short: string, long: string): SmaSnapshot =>
  SmaSnapshot.of({
    shortSma: SmaValue.of(short),
    longSma: SmaValue.of(long),
    previousShortSma: SmaValue.of(short),
    previousLongSma: SmaValue.of(long),
  });

describe('BarReconciled', () => {
  const at = Timestamp.of(new Date('2024-01-15T10:15:15.000Z'));

  it('是正前後の SMA と時間足を保持する', () => {
    const before = snapshot('100', '102');
    const after = snapshot('101', '103');

    const event = new BarReconciled(TimeFrame.FIFTEEN_MINUTE, at, before, after);

    expect(event.timeFrame).toBe(TimeFrame.FIFTEEN_MINUTE);
    expect(event.reconciledAt).toBe(at);
    expect(event.before).toBe(before);
    expect(event.after).toBe(after);
  });

  it('before は未安定からの是正のとき null を許容するが after は常に存在する', () => {
    const after = snapshot('101', '103');

    const event = new BarReconciled(TimeFrame.ONE_HOUR, at, null, after);

    expect(event.before).toBeNull();
    expect(event.after).toBe(after);
  });
});
