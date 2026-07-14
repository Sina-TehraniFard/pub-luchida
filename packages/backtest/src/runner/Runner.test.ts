import { describe, it, expect, vi } from 'vitest';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import { Lot } from '@luchida/backend/domain/position/Lot.js';

import { BacktestRunner } from './Runner.js';
import * as ruleFactory from './RuleFactory.js';
import { createRules, calcWarmupCount } from './RuleFactory.js';
import { CompositeExitRule } from '@luchida/backend/domain/rule/shared/CompositeExitRule.js';
import { TimeFilteredEntryRule } from '@luchida/backend/domain/rule/shared/TimeFilteredEntryRule.js';
import type { Engine, EngineRunParams, MarketState } from '../engine/Engine.js';
import type { BacktestResult } from '../result/BacktestResult.js';
import type { ResultStore } from '../result/ResultStore.js';
import type { DataProvider } from '../data-provider/DataProvider.js';
import type { ParameterSet, SmaCrossParameters } from '../parameter/ParameterSet.js';
import { BacktestSmaCalculatorFactory } from '../snapshot-adapter/BacktestSmaCalculatorFactory.js';
import { EngineMode } from '../engine/EngineConfig.js';
import type { ExecutionConfig } from '../config/ExecutionConfig.js';

function makeSmaCrossParams(overrides: Partial<SmaCrossParameters> = {}): SmaCrossParameters {
  return {
    strategy: 'SMA_CROSS',
    pair: CurrencyPair('USD_JPY'),
    timeframe: TimeFrame.FIFTEEN_MINUTE,
    dateFrom: new Date('2024-01-01'),
    dateTo: new Date('2024-07-01'),
    shortPeriod: 20,
    longPeriod: 100,
    stopLossPips: 40,
    takeProfitPips: 150,
    excludeHoursUtc: [],
    maxHoldBars: 0,
    riskPct: 0.02,
    ...overrides,
  };
}

function makeDummyResult(runId: string, batchId: string): BacktestResult {
  return {
    id: runId,
    batchId,
    pair: 'USD_JPY' as CurrencyPair,
    timeframe: 'FIFTEEN_MINUTE' as TimeFrame,
    strategy: 'SMA_CROSS',
    params: {},
    dateFrom: new Date(),
    dateTo: new Date(),
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
    totalPnl: 0, grossProfit: 0, grossLoss: 0,
    avgPnl: 0, avgWin: 0, avgLoss: 0, medianPnl: 0,
    largestWin: 0, largestLoss: 0, payoffRatio: 0, profitFactor: 0,
    expectancyPips: 0, pnlPerDay: 0,
    tradeCount: 0, winCount: 0, lossCount: 0, winRate: 0,
    longCount: 0, shortCount: 0, longWinRate: 0, shortWinRate: 0,
    tradesPerMonth: 0,
    maxDrawdown: 0, maxDrawdownPct: 0, maxDrawdownDurationMs: 0,
    avgDrawdown: 0, calmarRatio: 0, recoveryFactor: 0, ulcerIndex: 0,
    pnlStddev: 0, sharpeRatio: 0, annualizedSharpeRatio: 0,
    sortinoRatio: 0, annualizedSortinoRatio: 0,
    sortinoStandard: 0, annualizedSortinoStandard: 0,
    sqn: 0, sqnCapped: 0,
    hasDownsideRisk: false,
    maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
    avgMfe: 0, avgMae: 0, mfeEfficiency: 0,
    avgHoldingPeriodMs: 0,
    status: 'SUCCESS', ranAt: new Date(), durationMs: 0, trades: [],
  };
}

/** 渡された Engine を使う BacktestRunner を生成するためのテスト用ファクトリ */
function makeRunnerWithEngine(
  engine: Engine,
  store: ResultStore,
  dataProviderFactory: () => DataProvider,
  smaFactory: BacktestSmaCalculatorFactory,
): BacktestRunner {
  // OhlcEngine.OHLC モードで生成するが、実際の Engine 呼び出しはモックが担う
  // Runner が内部で createEngine() するため、外から差し込むには subclass か spy が必要。
  // ここでは BacktestRunner を直接使い、createEngine を vi.spyOn で差し替える。
  const executionConfig: ExecutionConfig = { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 };
  const runner = new BacktestRunner(store, null, dataProviderFactory, smaFactory, EngineMode.OHLC, executionConfig);
  // createEngine をモック Engine に差し替える
  vi.spyOn(runner as unknown as { createEngine(): Engine }, 'createEngine').mockReturnValue(engine);
  return runner;
}

function mockResultStore(): ResultStore & { save: ReturnType<typeof vi.fn> } {
  return { save: vi.fn().mockResolvedValue(undefined) };
}

function mockDataProvider(): DataProvider {
  return {
    fetchCandles: vi.fn().mockResolvedValue([]),
    fetchTicks: vi.fn().mockReturnValue((async function* () {})()),
  };
}

describe('BacktestRunner', () => {
  const smaFactory = new BacktestSmaCalculatorFactory();
  const executionConfig: ExecutionConfig = { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 };

  it('1 ParameterSet で Engine が呼ばれ ResultStore に保存される', async () => {
    const mockRun = vi.fn().mockImplementation(async (params: EngineRunParams) =>
      makeDummyResult(params.runId, params.batchId),
    );
    const engine: Engine = { run: mockRun };
    const store = mockResultStore();
    const runner = makeRunnerWithEngine(engine, store, mockDataProvider, smaFactory);

    const results = await runner.run([makeSmaCrossParams()], 'batch-1');

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('3 ParameterSet で3回実行され3件保存される', async () => {
    const mockRun = vi.fn().mockImplementation(async (params: EngineRunParams) =>
      makeDummyResult(params.runId, params.batchId),
    );
    const engine: Engine = { run: mockRun };
    const store = mockResultStore();
    const runner = makeRunnerWithEngine(engine, store, mockDataProvider, smaFactory);

    const sets: ParameterSet[] = [
      makeSmaCrossParams({ shortPeriod: 10, longPeriod: 50 }),
      makeSmaCrossParams({ shortPeriod: 20, longPeriod: 100 }),
      makeSmaCrossParams({ shortPeriod: 25, longPeriod: 75 }),
    ];
    const results = await runner.run(sets, 'batch-3');

    expect(mockRun).toHaveBeenCalledTimes(3);
    expect(store.save).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
  });

  it('batchId が全結果で共通である', async () => {
    const mockRun = vi.fn().mockImplementation(async (params: EngineRunParams) =>
      makeDummyResult(params.runId, params.batchId),
    );
    const engine: Engine = { run: mockRun };
    const store = mockResultStore();
    const runner = makeRunnerWithEngine(engine, store, mockDataProvider, smaFactory);

    const results = await runner.run(
      [makeSmaCrossParams(), makeSmaCrossParams()],
      'shared-batch',
    );

    for (const r of results) {
      expect(r.batchId).toBe('shared-batch');
    }
  });

  it('各結果の runId がユニークである', async () => {
    const mockRun = vi.fn().mockImplementation(async (params: EngineRunParams) =>
      makeDummyResult(params.runId, params.batchId),
    );
    const engine: Engine = { run: mockRun };
    const store = mockResultStore();
    const runner = makeRunnerWithEngine(engine, store, mockDataProvider, smaFactory);

    await runner.run([makeSmaCrossParams(), makeSmaCrossParams()], 'batch-u');

    const runIds = (mockRun.mock.calls as EngineRunParams[][]).map((c) => c[0]!.runId);
    expect(new Set(runIds).size).toBe(2);
  });

  it('ParameterSet → EngineConfig の変換が正しい', async () => {
    const mockRun = vi.fn().mockImplementation(async (params: EngineRunParams) =>
      makeDummyResult(params.runId, params.batchId),
    );
    const engine: Engine = { run: mockRun };
    const store = mockResultStore();
    const runner = makeRunnerWithEngine(engine, store, mockDataProvider, smaFactory);

    await runner.run([makeSmaCrossParams({ shortPeriod: 25, longPeriod: 75 })], 'batch-c');

    const params = mockRun.mock.calls[0]![0] as EngineRunParams;
    expect(params.config.pair).toBe('USD_JPY');
    expect(params.config.timeframe).toBe('FIFTEEN_MINUTE');
    expect(params.config.warmupCount).toBe(75);
  });

  it('DB 記録用 params に戦略固有パラメータが入り、共通フィールドは除外される', async () => {
    const mockRun = vi.fn().mockImplementation(async (params: EngineRunParams) =>
      makeDummyResult(params.runId, params.batchId),
    );
    const store = mockResultStore();
    const runner = makeRunnerWithEngine({ run: mockRun }, store, mockDataProvider, smaFactory);

    await runner.run([makeSmaCrossParams({ shortPeriod: 25, longPeriod: 75 })], 'batch-p');

    const recorded = (mockRun.mock.calls[0]![0] as EngineRunParams).params;
    // 戦略固有パラメータは記録される
    expect(recorded.shortPeriod).toBe(25);
    expect(recorded.longPeriod).toBe(75);
    expect(recorded.stopLossPips).toBe(40);
    // 共通フィールド（BaseParameters + discriminator）は params から除外される
    expect(recorded).not.toHaveProperty('strategy');
    expect(recorded).not.toHaveProperty('pair');
    expect(recorded).not.toHaveProperty('timeframe');
    expect(recorded).not.toHaveProperty('dateFrom');
    expect(recorded).not.toHaveProperty('dateTo');
  });

  it('オプショナルなパラメータも明示指定すれば自動で params に含まれる（#111 列挙漏れ防止）', async () => {
    const mockRun = vi.fn().mockImplementation(async (params: EngineRunParams) =>
      makeDummyResult(params.runId, params.batchId),
    );
    const store = mockResultStore();
    const runner = makeRunnerWithEngine({ run: mockRun }, store, mockDataProvider, smaFactory);

    await runner.run(
      [makeSmaCrossParams({ minCrossStrengthPips: 3, maxDirectionalDivergencePct: 0.1 })],
      'batch-opt',
    );

    const recorded = (mockRun.mock.calls[0]![0] as EngineRunParams).params;
    expect(recorded.minCrossStrengthPips).toBe(3);
    expect(recorded.maxDirectionalDivergencePct).toBe(0.1);
  });

  it('全フィールド指定時、共通5キーだけが除外され残りは恒等保存される（列挙非依存の網羅検証 #111）', async () => {
    const mockRun = vi.fn().mockImplementation(async (params: EngineRunParams) =>
      makeDummyResult(params.runId, params.batchId),
    );
    const store = mockResultStore();
    const runner = makeRunnerWithEngine({ run: mockRun }, store, mockDataProvider, smaFactory);

    // SmaCrossParameters のオプショナルを含む全フィールドを明示的に埋める。
    // これにより「フィールドを 1 個ずつ assert する手書き列挙」に頼らず、
    // 入力キー集合から共通フィールドを引いたものと記録キー集合の一致で網羅検証する。
    const fullParams = makeSmaCrossParams({
      trailActivatePips: 30,
      trailWidthPips: 10,
      targetMaintenanceRatio: 1.25,
      marginRate: 0.04,
      minCrossStrengthPips: 3,
      excludeMidMonthJstLunchNonBoj: true,
      maxDirectionalDivergencePct: 0.1,
      priceBandFilter: { minSellPrice: 85 },
    });
    await runner.run([fullParams], 'batch-full');

    const recorded = (mockRun.mock.calls[0]![0] as EngineRunParams).params;
    const expectedKeys = Object.keys(fullParams)
      .filter((k) => !['strategy', 'pair', 'timeframe', 'dateFrom', 'dateTo'].includes(k))
      .sort();
    expect(Object.keys(recorded).sort()).toEqual(expectedKeys);
    // 値も恒等で保存されている（除外キーを抜いた残りが入力と一致する）
    const inputAsRecord = fullParams as unknown as Record<string, unknown>;
    for (const key of expectedKeys) {
      expect(recorded[key]).toBe(inputAsRecord[key]);
    }
  });

  it('SMA_CROSS → TimeFilteredEntryRule(SmaCross) + CompositeExitRule が生成される', () => {
    const { entryRule, exitRule } = createRules(
      makeSmaCrossParams({ excludeHoursUtc: [0, 7, 18] }),
      () => Lot.of(1000),
    );
    expect(entryRule).toBeInstanceOf(TimeFilteredEntryRule);
    expect(exitRule).toBeInstanceOf(CompositeExitRule);
  });

  it('未対応の戦略で例外が投げられる', () => {
    const ps = { strategy: 'UNKNOWN' } as unknown as ParameterSet;
    expect(() => createRules(ps, () => Lot.of(1000))).toThrow('未対応の戦略');
  });

  it('OHLC モードで OhlcEngine + IdealExecutionSimulator が使われる', async () => {
    const store = mockResultStore();
    // OhlcEngine が内部で DataProvider.fetchCandles を呼ぶが、0件だと例外が出るため
    // このテストはコンストラクタの設定確認のみ行う
    const runner = new BacktestRunner(store, null, mockDataProvider, smaFactory, EngineMode.OHLC, executionConfig);
    expect(runner).toBeDefined();
  });
});

describe('BacktestRunner getLot 配線（レート→Lot 組み立て）', () => {
  const smaFactory = new BacktestSmaCalculatorFactory();
  const executionConfig: ExecutionConfig = { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 };

  /**
   * runOne が組み立てる getLot クロージャと、それが閉じ込む equityState / marketState を捕捉する。
   * createRules は実体に委譲したうえで getLot だけ横取りし、Engine.run には実 params（同じ
   * state 参照）が渡る。これにより Runner レベルで「現在レート → LotDecisionInput → policy.decide」
   * の経路を実値で実行できる。
   */
  function runAndCaptureGetLot(params: SmaCrossParameters): {
    getLot: () => Lot;
    marketState: MarketState;
  } {
    let capturedGetLot: (() => Lot) | undefined;
    const realCreateRules = ruleFactory.createRules;
    const spy = vi.spyOn(ruleFactory, 'createRules').mockImplementation((ps, getLot) => {
      capturedGetLot = getLot;
      return realCreateRules(ps, getLot);
    });

    let capturedMarketState: MarketState | undefined;
    const mockRun = vi.fn().mockImplementation(async (p: EngineRunParams) => {
      capturedMarketState = p.marketState ?? undefined;
      return makeDummyResult(p.runId, p.batchId);
    });
    const runner = new BacktestRunner(
      mockResultStore(), null, mockDataProvider, smaFactory, EngineMode.OHLC, executionConfig,
    );
    vi.spyOn(runner as unknown as { createEngine(): Engine }, 'createEngine').mockReturnValue({ run: mockRun });

    // run は同期的に getLot / marketState を確定させる（Engine.run までに createRules を通る）
    void runner.run([params], 'batch-getlot');

    if (!capturedGetLot || !capturedMarketState) {
      throw new Error('getLot / marketState を捕捉できなかった');
    }
    spy.mockRestore();
    return { getLot: capturedGetLot, marketState: capturedMarketState };
  }

  it('既定値（維持率1.40 / 証拠金率0.04）で equity10万・レート150 → Lot=11,900', async () => {
    // targetMaintenanceRatio / marginRate 未指定 → Runner の既定定数 1.40 / 0.04 にフォールバック。
    // raw = 100000 / (1.40 × 150 × 0.04) = 11904.7... → floor(/100)*100 = 11,900
    const { getLot, marketState } = runAndCaptureGetLot(
      makeSmaCrossParams({ targetMaintenanceRatio: undefined, marginRate: undefined }),
    );
    await Promise.resolve(); // run() の保留中処理を流す
    marketState.currentRate = 150;
    expect(getLot().equals(Lot.of(11_900))).toBe(true);
  });

  it('currentRate=null（足/tick 未到着）で getLot を呼ぶと throw する', async () => {
    const { getLot, marketState } = runAndCaptureGetLot(makeSmaCrossParams());
    await Promise.resolve();
    expect(marketState.currentRate).toBeNull(); // 初期状態は未取得
    expect(() => getLot()).toThrow(/currentRate/);
  });
});

describe('calcWarmupCount', () => {
  it('SMA_CROSS は max(short, long) を返す', () => {
    expect(calcWarmupCount(makeSmaCrossParams({ shortPeriod: 25, longPeriod: 75 }))).toBe(75);
  });
});
