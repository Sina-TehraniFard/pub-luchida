import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketDataStream } from './MarketDataStream.js';
import { Price } from '../domain/market/Price.js';
import { Tick } from '../domain/market/tick/Tick.js';
import { TickTimestamp } from '../domain/market/tick/TickTimestamp.js';
import type { MarketDataPort } from '../port/MarketDataPort.js';
import type { TimeFrameBook } from '../domain/market/TimeFrameBook.js';
import type { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';

// ── モック ──────────────────────────────────────────────────

const makeTick = (): Tick =>
    Tick.of(
        Price.of('150.001'),
        Price.of('149.999'),
        TickTimestamp.of(new Date('2024-01-15T10:00:00.000Z')),
    );

const mockMarketDataPort = (): MarketDataPort => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
});

const mockTimeFrameBook = (): Partial<TimeFrameBook> => ({
    onTick: vi.fn().mockReturnValue({} as MarketSnapshot),
});

// ── テスト ──────────────────────────────────────────────────

describe('MarketDataStream', () => {
    let port: MarketDataPort;
    let book: TimeFrameBook;
    let listener: (snapshot: MarketSnapshot) => void;
    let stream: MarketDataStream;

    beforeEach(() => {
        port = mockMarketDataPort();
        book = mockTimeFrameBook() as TimeFrameBook;
        listener = vi.fn<(snapshot: MarketSnapshot) => void>();
        stream = new MarketDataStream(port, book, listener);
    });

    describe('start()', () => {
        it('MarketDataPort.connect が呼ばれる', async () => {
            // Given: 開始前のストリーム

            // When: start を呼ぶ
            await stream.start();

            // Then: connect が呼ばれている
            expect(port.connect).toHaveBeenCalledTimes(1);
        });

        it('MarketDataPort.subscribe が呼ばれる', async () => {
            // Given: 開始前のストリーム

            // When: start を呼ぶ
            await stream.start();

            // Then: subscribe にコールバック関数が渡されている
            expect(port.subscribe).toHaveBeenCalledTimes(1);
            expect(port.subscribe).toHaveBeenCalledWith(expect.any(Function));
        });

        it('tick が届くと TimeFrameBook.onTick が呼ばれる', async () => {
            // Given: subscribe のコールバックを捕捉する
            let onTickCallback: ((tick: Tick) => void) | null = null;
            vi.mocked(port.subscribe).mockImplementation((cb) => {
                onTickCallback = cb;
                return () => {};
            });
            await stream.start();

            // When: tick を送信
            const tick = makeTick();
            onTickCallback!(tick);

            // Then: TimeFrameBook.onTick に tick が渡されている
            expect(book.onTick).toHaveBeenCalledWith(tick);
        });

        it('tick が届くと listener に MarketSnapshot が渡される', async () => {
            // Given: TimeFrameBook が MarketSnapshot を返すように設定
            const fakeSnapshot = { fake: true } as unknown as MarketSnapshot;
            vi.mocked(book.onTick).mockReturnValue(fakeSnapshot);
            let onTickCallback: ((tick: Tick) => void) | null = null;
            vi.mocked(port.subscribe).mockImplementation((cb) => {
                onTickCallback = cb;
                return () => {};
            });
            await stream.start();

            // When: tick を送信
            onTickCallback!(makeTick());

            // Then: listener に MarketSnapshot が渡されている
            expect(listener).toHaveBeenCalledWith(fakeSnapshot);
        });
    });

    describe('stop()', () => {
        it('購読解除関数が呼ばれる', async () => {
            // Given: start 済みのストリーム
            const unsubscribe = vi.fn();
            vi.mocked(port.subscribe).mockReturnValue(unsubscribe);
            await stream.start();

            // When: stop を呼ぶ
            await stream.stop();

            // Then: subscribe が返した解除関数が呼ばれている
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });

        it('MarketDataPort.disconnect が呼ばれる', async () => {
            // Given: start 済みのストリーム
            await stream.start();

            // When: stop を呼ぶ
            await stream.stop();

            // Then: disconnect が呼ばれている
            expect(port.disconnect).toHaveBeenCalledTimes(1);
        });
    });
});
