import { randomUUID } from 'node:crypto';
import { MaintenanceRatioBasedLotPolicy } from '@luchida/backend/domain/position/MaintenanceRatioBasedLotPolicy.js';
import type { LotPolicy } from '@luchida/backend/domain/position/LotPolicy.js';
import { LotDecisionInput } from '@luchida/backend/domain/position/LotDecisionInput.js';
import type { Lot } from '@luchida/backend/domain/position/Lot.js';
import { MaintenanceRatio } from '@luchida/backend/domain/position/MaintenanceRatio.js';
import { MarginRate } from '@luchida/backend/domain/position/MarginRate.js';
import { Balance } from '@luchida/backend/domain/Balance.js';
import { Money } from '@luchida/backend/domain/Money.js';
import { Rate } from '@luchida/backend/domain/market/Rate.js';
import { pipUnit, quote } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { Engine, EngineRunParams } from '../engine/Engine.js';
import type { EquityState, MarketState } from '../engine/Engine.js';
import { EngineMode } from '../engine/EngineConfig.js';
import type { ResultStore } from '../result/ResultStore.js';
import type { BatchStore } from '../result/BatchStore.js';
import type { BacktestResult, SampleType } from '../result/BacktestResult.js';
import type { DataProvider } from '../data-provider/DataProvider.js';
import type { ParameterSet } from '../parameter/ParameterSet.js';
import { BASE_PARAMETER_KEYS } from '../parameter/ParameterSet.js';
import type { SnapshotAdapter } from '../snapshot-adapter/SnapshotAdapter.js';
import type { SmaCalculatorFactory } from '@luchida/backend/domain/market/indicator/SmaCalculator.js';
import type { ExecutionSimulator } from '../simulator/ExecutionSimulator.js';
import type { ExecutionConfig } from '../config/ExecutionConfig.js';
import { BacktestSnapshotAdapter } from '../snapshot-adapter/BacktestSnapshotAdapter.js';
import { IdealExecutionSimulator } from '../simulator/IdealExecutionSimulator.js';
import { RealisticExecutionSimulator } from '../simulator/RealisticExecutionSimulator.js';
import { SlippageModel } from '../simulator/SlippageModel.js';
import { SeededRandom } from '../simulator/SeededRandom.js';
import { OhlcEngine } from '../engine/OhlcEngine.js';
import { TickEngine } from '../engine/TickEngine.js';
import { PendingOrderManager } from '../engine/PendingOrderManager.js';
import { createRules, calcWarmupCount } from './RuleFactory.js';

/**
 * `targetMaintenanceRatio` 未指定時の既定値（= 140%）。
 * backend main.ts の TARGET_MAINTENANCE_RATIO（'1.40'）と揃える。
 */
const DEFAULT_TARGET_MAINTENANCE_RATIO = '1.40';

/**
 * `marginRate` 未指定時の既定値（= レバレッジ 25 倍）。
 * backend GmoConstants.MARGIN_RATE（'0.04'）と揃える。
 */
const DEFAULT_MARGIN_RATE = '0.04';

/**
 * ParameterSet[] を順に実行し、結果を ResultStore に保存する。
 * Engine / Rule / Simulator の組み立てはここで行う。
 *
 * BatchStore が注入されている場合はバッチのライフサイクルも管理する。
 * JSON モード（BatchStore = null）ではバッチ管理をスキップする。
 */
export class BacktestRunner {
  constructor(
    private readonly resultStore: ResultStore,
    private readonly batchStore: BatchStore | null,
    private readonly dataProviderFactory: () => DataProvider,
    private readonly smaCalculatorFactory: SmaCalculatorFactory,
    private readonly mode: EngineMode,
    private readonly executionConfig: ExecutionConfig,
    private readonly initialCapital: number = 100_000,
    private readonly codeVersion: string = 'unknown',
  ) {}

  async run(
    parameterSets: ReadonlyArray<ParameterSet>,
    batchId: string,
    description: string = '',
    sampleMeta: { sampleType: SampleType; foldNumber: number | null } = { sampleType: 'FULL', foldNumber: null },
  ): Promise<BacktestResult[]> {
    if (this.batchStore && parameterSets.length > 0) {
      const ps0 = parameterSets[0]!;
      await this.batchStore.create({
        batchId,
        description,
        totalRuns: parameterSets.length,
        strategy: ps0.strategy,
        pair: ps0.pair,
        timeframe: ps0.timeframe,
      });
    }

    const results: BacktestResult[] = [];
    try {
      for (const ps of parameterSets) {
        const result = await this.runOne(ps, batchId, sampleMeta);
        await this.resultStore.save(result);
        results.push(result);
      }
      if (this.batchStore) {
        await this.batchStore.complete(batchId, 'COMPLETED');
      }
    } catch (e) {
      if (this.batchStore) {
        await this.batchStore.complete(batchId, 'FAILED');
      }
      throw e;
    }
    return results;
  }

  private async runOne(
    ps: ParameterSet,
    batchId: string,
    sampleMeta: { sampleType: SampleType; foldNumber: number | null },
  ): Promise<BacktestResult> {
    const equityState: EquityState = { equity: this.initialCapital };
    const marketState: MarketState = { currentRate: null };
    const lotPolicy = this.createLotPolicy();
    const targetRatio = ps.strategy === 'SMA_CROSS' ? ps.targetMaintenanceRatio : undefined;
    const overrideMarginRate = ps.strategy === 'SMA_CROSS' ? ps.marginRate : undefined;
    const target = MaintenanceRatio.of(targetRatio ?? DEFAULT_TARGET_MAINTENANCE_RATIO);
    const marginRate = MarginRate.of(overrideMarginRate ?? DEFAULT_MARGIN_RATE);
    const getLot = () => this.decideLot(lotPolicy, ps.pair, equityState, marketState, target, marginRate);

    const { entryRule, exitRule } = createRules(ps, getLot);
    const warmupCount = calcWarmupCount(ps);

    const params: EngineRunParams = {
      config: {
        pair: ps.pair,
        timeframe: ps.timeframe,
        dateRange: { from: ps.dateFrom, to: ps.dateTo },
        warmupCount,
      },
      entryRule,
      exitRule,
      dataProvider: this.dataProviderFactory(),
      snapshotAdapter: this.createSnapshotAdapter(ps),
      executionSimulator: this.createSimulator(ps.pair),
      runId: randomUUID(),
      batchId,
      strategy: ps.strategy,
      params: extractStrategyParams(ps),
      equityState,
      marketState,
      initialCapital: this.initialCapital,
      engineMode: this.mode,
      executionConfig: this.executionConfig,
      codeVersion: this.codeVersion,
      sampleType: sampleMeta.sampleType,
      foldNumber: sampleMeta.foldNumber,
      additionalIndicatorSpecs: collectIndicatorSpecs(ps).specs.filter(s => s.timeFrame !== ps.timeframe),
    };

    return this.createEngine().run(params);
  }

  /**
   * BT のロット決定は維持率ベース（`MaintenanceRatioBasedLotPolicy`）に限定する。
   *
   * backend の `RiskBasedLotPolicy` は `decide` が throw する未実装状態（Step5 以降で対応予定）の
   * ため、BT 経路では使わない（#306 確定判断）。policy は状態を持たない純粋ドメインサービスなので
   * run 全体で 1 インスタンスを使い回す。
   */
  private createLotPolicy(): LotPolicy {
    return new MaintenanceRatioBasedLotPolicy();
  }

  /**
   * 現在の equity / rate から `LotDecisionInput` を組み立てて `LotPolicy.decide()` を呼ぶ。
   *
   * I/O（残高・レート）を呼び出し側で束ねてから渡す新 LotPolicy 設計（backend
   * PositionSizingService と同じ流儀）に追従する。複利のため equity は毎回読み直す。
   * `currentRate` が null（最初の足/tick 未到着）の間に Lot を要求された場合は、
   * Engine 側の前提違反として明示的に throw する。
   */
  private decideLot(
    lotPolicy: LotPolicy,
    pair: CurrencyPair,
    equityState: EquityState,
    marketState: MarketState,
    target: MaintenanceRatio,
    marginRate: MarginRate,
  ): Lot {
    const currentRate = marketState.currentRate;
    if (currentRate === null) {
      throw new Error(`Lot 計算時に currentRate が未取得です: ${pair}`);
    }
    const balance = Balance.of(Money.of(equityState.equity, quote(pair)));
    const rate = Rate.of(currentRate, pair, new Date());
    const input = LotDecisionInput.of(pair, balance, rate, target, marginRate);
    return lotPolicy.decide(input);
  }

  private createEngine(): Engine {
    switch (this.mode) {
      case EngineMode.OHLC:
        return new OhlcEngine();
      case EngineMode.TICK:
        return new TickEngine(
          new PendingOrderManager(this.executionConfig.executionDelayMs),
        );
    }
  }

  private createSimulator(pair: CurrencyPair): ExecutionSimulator {
    switch (this.mode) {
      case EngineMode.OHLC:
        return new IdealExecutionSimulator();
      case EngineMode.TICK:
        return new RealisticExecutionSimulator(
          new SlippageModel(
            this.executionConfig.slippageStddevPips,
            new SeededRandom(this.executionConfig.randomSeed),
            pipUnit(pair).toNumber(),
          ),
        );
    }
  }

  private createSnapshotAdapter(ps: ParameterSet): SnapshotAdapter {
    switch (ps.strategy) {
      case 'SMA_CROSS': {
        const { signal, specs } = collectIndicatorSpecs(ps);
        return new BacktestSnapshotAdapter(ps.pair, signal, specs, this.smaCalculatorFactory);
      }
      default:
        throw new Error(`未対応の戦略: ${ps.strategy}`);
    }
  }
}

/**
 * ParameterSet から「BacktestSnapshotAdapter が計算すべき indicator spec 一覧」を集約する。
 *
 * 純関数。RuleFactory が要求する timeframe を Adapter にも漏れなく登録するための
 * SSoT（Single Source of Truth）。
 */
export function collectIndicatorSpecs(ps: ParameterSet): {
  signal: import('@luchida/backend/domain/market/TimeFrame.js').TimeFrame;
  specs: ReadonlyArray<import('@luchida/backend/domain/market/indicator/TimeFrameIndicatorSpec.js').TimeFrameIndicatorSpec>;
} {
  switch (ps.strategy) {
    case 'SMA_CROSS': {
      const specs = [
        { timeFrame: ps.timeframe, shortPeriod: ps.shortPeriod, longPeriod: ps.longPeriod },
      ];
      return { signal: ps.timeframe, specs };
    }
    default:
      throw new Error(`未対応の戦略: ${(ps as ParameterSet).strategy}`);
  }
}

/**
 * DB 記録用に「戦略固有パラメータ」だけを取り出す。
 *
 * 除外するのは BaseParameters の共通フィールド（BASE_PARAMETER_KEYS）と、
 * discriminator の strategy のみ。残り全てを返す。これにより、ParameterSet に
 * パラメータを 1 つ追加すれば DB 記録にも自動で反映され、列挙の書き忘れによる
 * 「実験したのに再現条件が DB に残らない」事故を構造的に防ぐ。
 *
 * 除外対象は BaseParameters の隣に置いた BASE_PARAMETER_KEYS を単一ソースとし、
 * ここで共通フィールド名をハードコードしない（二重管理による列挙漏れの再発防止）。
 * strategy は BaseParameters のメンバーではないため別途除外する。
 */
function extractStrategyParams(ps: ParameterSet): Record<string, unknown> {
  const excluded = new Set<string>([...BASE_PARAMETER_KEYS, 'strategy']);
  return Object.fromEntries(
    Object.entries(ps).filter(([key]) => !excluded.has(key)),
  );
}
