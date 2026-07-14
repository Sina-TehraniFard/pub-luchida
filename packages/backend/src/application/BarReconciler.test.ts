import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CandleHistoryPort } from '../port/CandleHistoryPort.js';
import { TimeFrameBook } from '../domain/market/TimeFrameBook.js';
import { TimeFrame } from '../domain/market/TimeFrame.js';
import { Timestamp } from '../domain/market/Timestamp.js';
import { ConfirmedCandle } from '../domain/market/candle/ConfirmedCandle.js';
import { Price } from '../domain/market/Price.js';
import { CandleOpenTime } from '../domain/market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '../domain/market/candle/CandleCloseTime.js';
import { BarReconciled } from '../domain/market/indicator/BarReconciled.js';
import { SmaSnapshot } from '../domain/market/indicator/SmaSnapshot.js';
import { SmaValue } from '../domain/market/indicator/SmaValue.js';
import { Logger } from '../infrastructure/logging/Logger.js';
import { BarReconciler } from './BarReconciler.js';

const snapshot = (short: string, long: string): SmaSnapshot =>
  SmaSnapshot.of({
    shortSma: SmaValue.of(short),
    longSma: SmaValue.of(long),
    previousShortSma: SmaValue.of(short),
    previousLongSma: SmaValue.of(long),
  });

const candle = (close: string): ConfirmedCandle => {
  const p = Price.of(close);
  const open = new Date('2024-01-15T10:00:00.000Z');
  const closeT = new Date('2024-01-15T10:14:59.999Z');
  return ConfirmedCandle.of({
    open: p,
    high: p,
    low: p,
    close: p,
    openTime: CandleOpenTime.of(open),
    closeTime: CandleCloseTime.of(closeT),
    timeFrame: TimeFrame.FIFTEEN_MINUTE,
  });
};

describe('BarReconciler', () => {
  let port: { fetchRecent: ReturnType<typeof vi.fn> };
  let book: { reconcile: ReturnType<typeof vi.fn> };
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  let reconciler: BarReconciler;

  beforeEach(() => {
    port = { fetchRecent: vi.fn() };
    book = { reconcile: vi.fn() };
    logger = { info: vi.fn(), warn: vi.fn() };
    reconciler = new BarReconciler(
      port as unknown as CandleHistoryPort,
      book as unknown as TimeFrameBook,
      200,
      logger as unknown as Logger,
    );
  });

  it('公式足を取得して TimeFrameBook.reconcile に渡す', async () => {
    // Given
    const official = [candle('150'), candle('151')];
    port.fetchRecent.mockResolvedValue(official);
    book.reconcile.mockReturnValue(null); // 差分なし

    // When
    await reconciler.reconcile(TimeFrame.FIFTEEN_MINUTE);

    // Then
    expect(port.fetchRecent).toHaveBeenCalledWith(TimeFrame.FIFTEEN_MINUTE, 200);
    expect(book.reconcile).toHaveBeenCalledWith(TimeFrame.FIFTEEN_MINUTE, official);
  });

  it('差分が無い（reconcile が null）ときは補正ログを出さない', async () => {
    // Given
    port.fetchRecent.mockResolvedValue([candle('150')]);
    book.reconcile.mockReturnValue(null);

    // When
    await reconciler.reconcile(TimeFrame.FIFTEEN_MINUTE);

    // Then
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('是正があった（BarReconciled が返る）ときは補正ログを出す', async () => {
    // Given
    port.fetchRecent.mockResolvedValue([candle('150')]);
    book.reconcile.mockReturnValue(
      new BarReconciled(
        TimeFrame.FIFTEEN_MINUTE,
        Timestamp.now(),
        snapshot('100', '102'),
        snapshot('101', '103'),
      ),
    );

    // When
    await reconciler.reconcile(TimeFrame.FIFTEEN_MINUTE);

    // Then
    expect(book.reconcile).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('REST 取得が失敗したら TimeFrameBook には触らず return する', async () => {
    // Given
    port.fetchRecent.mockRejectedValue(new Error('timeout'));

    // When
    await reconciler.reconcile(TimeFrame.FIFTEEN_MINUTE);

    // Then: reconcile は呼ばれない（内部値のまま継続）
    expect(book.reconcile).not.toHaveBeenCalled();
  });

  it('REST 失敗で例外を投げない（クラッシュしない）', async () => {
    // Given
    port.fetchRecent.mockRejectedValue(new Error('boom'));

    // When / Then
    await expect(
      reconciler.reconcile(TimeFrame.FIFTEEN_MINUTE),
    ).resolves.toBeUndefined();
  });
});
