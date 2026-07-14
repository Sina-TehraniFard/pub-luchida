import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonResultStore } from './JsonResultStore.js';
import type { BacktestResult } from './BacktestResult.js';
import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';

const dummyResult: BacktestResult = {
  id: 'run-001',
  batchId: 'batch-001',
  pair: 'USD_JPY' as CurrencyPair,
  timeframe: 'FIFTEEN_MINUTE' as TimeFrame,
  strategy: 'SMA_CROSS',
  params: { shortPeriod: 25, longPeriod: 75 },
  dateFrom: new Date('2024-01-01T00:00:00Z'),
  dateTo: new Date('2024-06-01T00:00:00Z'),
  initialCapital: 100_000,
  engineMode: 'OHLC',
  executionConfig: { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 },
  codeVersion: 'test',
  tickCount: 0,
  barCount: 100,
  gapCount: 0,
  dataHash: '',
  sampleType: 'FULL',
  foldNumber: null,
  totalPnl: 12500,
  grossProfit: 25000,
  grossLoss: 12500,
  avgPnl: 125,
  avgWin: 500,
  avgLoss: 250,
  medianPnl: 100,
  largestWin: 3000,
  largestLoss: 1500,
  payoffRatio: 2.0,
  profitFactor: 2.0,
  expectancyPips: 2.5,
  pnlPerDay: 69,
  tradeCount: 100,
  winCount: 60,
  lossCount: 40,
  winRate: 0.6,
  longCount: 55,
  shortCount: 45,
  longWinRate: 0.63,
  shortWinRate: 0.56,
  tradesPerMonth: 16.7,
  maxDrawdown: 5000,
  maxDrawdownPct: 0.1,
  maxDrawdownDurationMs: 86400000,
  avgDrawdown: 2000,
  calmarRatio: 1.5,
  recoveryFactor: 2.5,
  ulcerIndex: 0.03,
  pnlStddev: 300,
  sharpeRatio: 1.8,
  annualizedSharpeRatio: 1.9,
  sortinoRatio: 2.2,
  annualizedSortinoRatio: 2.3,
  sortinoStandard: 2.4,
  annualizedSortinoStandard: 2.5,
  sqn: 3.1,
  sqnCapped: 0.9,
  hasDownsideRisk: true,
  maxConsecutiveWins: 8,
  maxConsecutiveLosses: 4,
  avgMfe: 15,
  avgMae: 8,
  mfeEfficiency: 0.65,
  avgHoldingPeriodMs: 3600000,
  status: 'SUCCESS',
  ranAt: new Date('2024-07-01T12:00:00Z'),
  durationMs: 45000,
  trades: [
    {
      id: 'trade-001',
      runId: 'run-001',
      tradeSeq: 0,
      side: 'BUY',
      entryTime: new Date('2024-01-15T10:00:00Z'),
      exitTime: new Date('2024-01-15T11:00:00Z'),
      entryPrice: 150.5,
      exitPrice: 151.0,
      lot: 100,
      pnl: 500,
      pnlPips: 50,
      pnlAmount: 0,
      capitalAtEntry: 100_000,
      mfe: 600,
      mae: 100,
      mfePips: 60,
      mfeTime: new Date('2024-01-15T10:30:00Z'),
      maePips: 10,
      maeTime: new Date('2024-01-15T10:15:00Z'),
      atrAtEntry: null,
      holdingPeriodMs: 3600000,
      exitType: 'TAKE_PROFIT',
      entryHourUtc: 10,
      entryDayOfWeek: 1,
      slippagePips: 0,
      equityAfter: 100_000,
    },
  ],
};

describe('JsonResultStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'bt-result-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('save でファイルが作成される', async () => {
    const store = new JsonResultStore(tmpDir);
    await store.save(dummyResult);

    const filePath = join(tmpDir, `${dummyResult.id}.json`);
    const s = await stat(filePath);
    expect(s.isFile()).toBe(true);
  });

  it('JSON の中身が BacktestResult の全フィールドを含む', async () => {
    const store = new JsonResultStore(tmpDir);
    await store.save(dummyResult);

    const filePath = join(tmpDir, `${dummyResult.id}.json`);
    const content = JSON.parse(await readFile(filePath, 'utf-8'));

    for (const key of Object.keys(dummyResult)) {
      expect(content).toHaveProperty(key);
    }
    expect(content.trades).toHaveLength(1);
    for (const key of Object.keys(dummyResult.trades[0]!)) {
      expect(content.trades[0]).toHaveProperty(key);
    }
  });

  it('Date フィールドが ISO 8601 文字列として直列化される', async () => {
    const store = new JsonResultStore(tmpDir);
    await store.save(dummyResult);

    const filePath = join(tmpDir, `${dummyResult.id}.json`);
    const content = JSON.parse(await readFile(filePath, 'utf-8'));

    expect(content.dateFrom).toBe('2024-01-01T00:00:00.000Z');
    expect(content.dateTo).toBe('2024-06-01T00:00:00.000Z');
    expect(content.ranAt).toBe('2024-07-01T12:00:00.000Z');
    expect(content.trades[0].entryTime).toBe('2024-01-15T10:00:00.000Z');
    expect(content.trades[0].exitTime).toBe('2024-01-15T11:00:00.000Z');
  });

  it('trades が空配列でも正常に保存される', async () => {
    const store = new JsonResultStore(tmpDir);
    const noTrades = { ...dummyResult, id: 'run-empty', trades: [] as BacktestResult['trades'] };
    await store.save(noTrades);

    const filePath = join(tmpDir, 'run-empty.json');
    const content = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(content.trades).toEqual([]);
    expect(content.tradeCount).toBe(100);
  });

  it('outputDir がなければ自動作成される', async () => {
    const nested = join(tmpDir, 'deep', 'nested', 'dir');
    const store = new JsonResultStore(nested);
    await store.save(dummyResult);

    const filePath = join(nested, `${dummyResult.id}.json`);
    const s = await stat(filePath);
    expect(s.isFile()).toBe(true);
  });

  it('同じ id で2回 save すると上書きされる', async () => {
    const store = new JsonResultStore(tmpDir);
    await store.save(dummyResult);

    const updated = { ...dummyResult, totalPnl: 99999 };
    await store.save(updated);

    const filePath = join(tmpDir, `${dummyResult.id}.json`);
    const content = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(content.totalPnl).toBe(99999);
  });
});
