import { describe, it, expect, vi } from 'vitest';
import type { QueryResult, PoolClient } from 'pg';

import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { TimeFrame, durationMs } from '@luchida/backend/domain/market/TimeFrame.js';

import { TimescaleDataProvider, type PgPoolLike } from './TimescaleDataProvider.js';

describe('TimescaleDataProvider', () => {
  describe('fetchCandles', () => {
    it('時間足に応じた interval 文字列と warmup 分を差し引いた from を SQL に渡す', async () => {
      // Given: 15分足 warmup 100本、range は 2024-01-02 の 1日分
      const queryMock = vi.fn<PgPoolLike['query']>().mockResolvedValue(emptyResult());
      const provider = new TimescaleDataProvider(poolMock({ query: queryMock }));
      const range = {
        from: new Date('2024-01-02T00:00:00Z'),
        to: new Date('2024-01-03T00:00:00Z'),
      };

      // When
      await provider.fetchCandles(
        CurrencyPair('USD_JPY'),
        TimeFrame.FIFTEEN_MINUTE,
        range,
        100,
      );

      // Then: クエリパラメータの検証
      expect(queryMock).toHaveBeenCalledTimes(1);
      const [sql, params] = queryMock.mock.calls[0]!;
      expect(sql).toContain('time_bucket');
      expect(sql).toContain('FROM fx_tick');
      expect(params[0]).toBe('15 minutes');
      expect(params[1]).toBe('USD_JPY');

      // warmup: 100本 × 15分 = 1500分 = 25時間 を from より前から取得
      const expectedFrom = new Date(range.from.getTime() - durationMs(TimeFrame.FIFTEEN_MINUTE) * 100);
      expect((params[2] as Date).getTime()).toBe(expectedFrom.getTime());
      expect(params[3]).toBe(range.to);
    });

    it('DB 行を ConfirmedCandle の配列に変換する', async () => {
      // Given: 2行分のダミーレスポンス（すべて bid 由来なので ask は含まれない）
      const bucket1 = new Date('2024-01-02T00:00:00Z');
      const bucket2 = new Date('2024-01-02T00:15:00Z');
      const queryMock = vi.fn<PgPoolLike['query']>().mockResolvedValue({
        rows: [
          { bucket: bucket1, open: '150.100', high: '150.200', low: '150.050', close: '150.150' },
          { bucket: bucket2, open: '150.150', high: '150.180', low: '150.090', close: '150.120' },
        ],
      } as unknown as QueryResult);
      const provider = new TimescaleDataProvider(poolMock({ query: queryMock }));

      // When
      const candles = await provider.fetchCandles(
        CurrencyPair('USD_JPY'),
        TimeFrame.FIFTEEN_MINUTE,
        { from: bucket1, to: new Date('2024-01-02T00:30:00Z') },
        0,
      );

      // Then
      expect(candles).toHaveLength(2);
      expect(candles[0]!.open.toString()).toBe('150.1');
      expect(candles[0]!.close.toString()).toBe('150.15');
      expect(candles[0]!.openTime.toDate().getTime()).toBe(bucket1.getTime());
      expect(candles[0]!.closeTime.toDate().getTime()).toBe(
        bucket1.getTime() + durationMs(TimeFrame.FIFTEEN_MINUTE),
      );
      expect(candles[0]!.timeFrame).toBe(TimeFrame.FIFTEEN_MINUTE);
    });

    it('全 TimeFrame で適切な interval 文字列が選択される', async () => {
      const cases: Array<[TimeFrame, string]> = [
        [TimeFrame.ONE_MINUTE, '1 minute'],
        [TimeFrame.FIFTEEN_MINUTE, '15 minutes'],
        [TimeFrame.ONE_HOUR, '1 hour'],
        [TimeFrame.ONE_DAY, '1 day'],
      ];

      for (const [tf, expectedInterval] of cases) {
        const queryMock = vi.fn<PgPoolLike['query']>().mockResolvedValue(emptyResult());
        const provider = new TimescaleDataProvider(poolMock({ query: queryMock }));
        await provider.fetchCandles(
          CurrencyPair('USD_JPY'),
          tf,
          { from: new Date('2024-01-02T00:00:00Z'), to: new Date('2024-01-03T00:00:00Z') },
          0,
        );
        expect(queryMock.mock.calls[0]![1][0]).toBe(expectedInterval);
      }
    });
  });

  describe('fetchTicks', () => {
    it('tick が正しい Tick オブジェクトとして yield される', async () => {
      // Given: 2行分の TickRow をストリームで返す
      const releaseMock = vi.fn();
      const clientMock = {
        query: vi.fn().mockReturnValue(
          asyncIterableFrom([
            { time: new Date('2024-01-02T00:00:00.100Z'), bid: '150.100', ask: '150.120' },
            { time: new Date('2024-01-02T00:00:00.200Z'), bid: '150.110', ask: '150.130' },
          ]),
        ),
        release: releaseMock,
      } as unknown as PoolClient;
      const connectMock = vi.fn<PgPoolLike['connect']>().mockResolvedValue(clientMock);
      const provider = new TimescaleDataProvider(poolMock({ connect: connectMock }));

      // When
      const ticks = [];
      for await (const tick of provider.fetchTicks(
        CurrencyPair('USD_JPY'),
        { from: new Date('2024-01-02T00:00:00Z'), to: new Date('2024-01-02T00:01:00Z') },
      )) {
        ticks.push(tick);
      }

      // Then
      expect(ticks).toHaveLength(2);
      expect(ticks[0]!.ask().toString()).toBe('150.12');
      expect(ticks[0]!.bid().toString()).toBe('150.1');
      expect(ticks[1]!.ask().toString()).toBe('150.13');
    });

    it('正常終了後に client.release() が呼ばれる', async () => {
      const releaseMock = vi.fn();
      const clientMock = {
        query: vi.fn().mockReturnValue(asyncIterableFrom([])),
        release: releaseMock,
      } as unknown as PoolClient;
      const connectMock = vi.fn<PgPoolLike['connect']>().mockResolvedValue(clientMock);
      const provider = new TimescaleDataProvider(poolMock({ connect: connectMock }));

      // When
      for await (const _ of provider.fetchTicks(
        CurrencyPair('USD_JPY'),
        { from: new Date('2024-01-02T00:00:00Z'), to: new Date('2024-01-02T00:01:00Z') },
      )) {
        // exhaust
      }

      // Then
      expect(releaseMock).toHaveBeenCalledTimes(1);
    });

    it('空の結果セットで例外なく終了する', async () => {
      const releaseMock = vi.fn();
      const clientMock = {
        query: vi.fn().mockReturnValue(asyncIterableFrom([])),
        release: releaseMock,
      } as unknown as PoolClient;
      const connectMock = vi.fn<PgPoolLike['connect']>().mockResolvedValue(clientMock);
      const provider = new TimescaleDataProvider(poolMock({ connect: connectMock }));

      // When
      const ticks = [];
      for await (const tick of provider.fetchTicks(
        CurrencyPair('USD_JPY'),
        { from: new Date('2024-01-02T00:00:00Z'), to: new Date('2024-01-02T00:01:00Z') },
      )) {
        ticks.push(tick);
      }

      // Then
      expect(ticks).toHaveLength(0);
      expect(releaseMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('close', () => {
    it('pool.end() を呼ぶ', async () => {
      const endMock = vi.fn<PgPoolLike['end']>().mockResolvedValue(undefined);
      const provider = new TimescaleDataProvider(poolMock({ end: endMock }));
      await provider.close();
      expect(endMock).toHaveBeenCalledTimes(1);
    });
  });
});

function emptyResult(): QueryResult {
  return { rows: [], rowCount: 0 } as unknown as QueryResult;
}

function poolMock(overrides: Partial<PgPoolLike>): PgPoolLike {
  return {
    query: vi.fn<PgPoolLike['query']>().mockResolvedValue(emptyResult()),
    connect: vi.fn<PgPoolLike['connect']>().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    } as unknown as PoolClient),
    end: vi.fn<PgPoolLike['end']>().mockResolvedValue(undefined),
    ...overrides,
  };
}

function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> & { destroy(): void } {
  return {
    destroy() {
      // stream.destroy() のスタブ
    },
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) return { value: items[i++]!, done: false as const };
          return { value: undefined as unknown as T, done: true as const };
        },
      };
    },
  };
}
