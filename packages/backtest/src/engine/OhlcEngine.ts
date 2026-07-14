import { Position } from '@luchida/backend/domain/position/Position.js';
import { ExtremeTracker } from '@luchida/backend/domain/position/ExtremeTracker.js';
import { ExitCommand, ExitType } from '@luchida/backend/domain/command/ExitCommand.js';
import { ExitReason } from '@luchida/backend/domain/command/ExitReason.js';
import { EntryCommand } from '@luchida/backend/domain/command/EntryCommand.js';
import { Price } from '@luchida/backend/domain/market/Price.js';
import { Timestamp } from '@luchida/backend/domain/market/Timestamp.js';
import { Tick } from '@luchida/backend/domain/market/tick/Tick.js';
import { TickTimestamp } from '@luchida/backend/domain/market/tick/TickTimestamp.js';
import { pipValuePerLotJpy } from '@luchida/backend/domain/market/PipUnit.js';
import { pipUnit } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { ConfirmedCandle } from '@luchida/backend/domain/market/candle/ConfirmedCandle.js';
import { SampleType } from '../result/BacktestResult.js';
import type { BacktestResult } from '../result/BacktestResult.js';
import type { TradeRecord } from '../result/TradeRecord.js';
import type { Engine, EngineRunParams } from './Engine.js';
import { calculate } from './ResultCalculator.js';
import { buildTradeRecord } from './TradeRecordBuilder.js';
import { BacktestSnapshotAdapter } from '../snapshot-adapter/BacktestSnapshotAdapter.js';
import type { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import type { ConfirmedCandle as ConfirmedCandleType } from '@luchida/backend/domain/market/candle/ConfirmedCandle.js';

export class OhlcEngine implements Engine {
  async run(params: EngineRunParams): Promise<BacktestResult> {
    const startTime = Date.now();
    const { config, entryRule, exitRule, dataProvider, snapshotAdapter, executionSimulator } = params;
    const { pair, timeframe, dateRange, warmupCount } = config;

    const additionalSpecs = params.additionalIndicatorSpecs ?? [];

    // 駆動足 + additional を並列 fetch（直列だと候補数 × tf 数で遅くなる）
    const [candles, ...additionalBundles] = await Promise.all([
      dataProvider.fetchCandles(pair, timeframe, dateRange, warmupCount),
      ...additionalSpecs.map(spec => dataProvider.fetchCandles(
        pair, spec.timeFrame, dateRange, spec.longPeriod,
      )),
    ]);

    if (candles.length === 0) {
      throw new Error('OhlcEngine: DataProvider が 0 本の足を返しました');
    }
    if (candles.length <= warmupCount) {
      throw new Error(
        `OhlcEngine: warmup に必要な足数が不足しています（必要: ${warmupCount + 1}, 取得: ${candles.length}）`,
      );
    }

    const positions = new Map<string, Position>();
    const extremeTracker = new ExtremeTracker();
    const trades: TradeRecord[] = [];
    // エントリー時の資金を記録するマップ
    const capitalAtEntryMap = new Map<string, number>();
    let tradeSeq = 0;
    const barCount = candles.length - warmupCount;

    if (additionalSpecs.length > 0 && snapshotAdapter instanceof BacktestSnapshotAdapter) {
      // multi-tf: 駆動足 warmup + additional warmup を一括投入
      const warmupCandlesByTf = new Map<TimeFrame, ReadonlyArray<ConfirmedCandleType>>();
      warmupCandlesByTf.set(timeframe, candles.slice(0, warmupCount));
      const upcomingByTf = new Map<TimeFrame, ReadonlyArray<ConfirmedCandleType>>();
      additionalSpecs.forEach((spec, idx) => {
        const all = additionalBundles[idx]!;
        warmupCandlesByTf.set(spec.timeFrame, all.slice(0, spec.longPeriod));
        upcomingByTf.set(spec.timeFrame, all.slice(spec.longPeriod));
      });
      snapshotAdapter.warmUpAll(warmupCandlesByTf);
      snapshotAdapter.setUpcomingConfirmsByTimeFrame(upcomingByTf);
    } else {
      snapshotAdapter.warmUp(candles.slice(0, warmupCount));
    }

    for (let i = warmupCount; i < candles.length - 1; i++) {
      const currentCandle = candles[i]!;
      const nextCandle = candles[i + 1]!;

      const latestTick = makeTick(currentCandle.close, pair, currentCandle);
      const snapshot = snapshotAdapter.addCandleAndBuild(currentCandle, latestTick, nextCandle.open);

      if (params.marketState) {
        params.marketState.currentRate = Number(currentCandle.close.toString());
      }

      for (const posId of positions.keys()) {
        extremeTracker.updateOhlc(posId, currentCandle.high, currentCandle.low);
      }

      // 決済判定
      for (const [posId, position] of positions) {
        const exitResult = exitRule.shouldExit(snapshot, position);
        if (exitResult instanceof ExitCommand) {
          const extremes = extremeTracker.get(posId);
          if (extremes) {
            position.applyExtremes(extremes.highest, extremes.lowest);
          }
          const simResult = executionSimulator.simulateExit(
            exitResult,
            nextCandle.open,
            pair,
            position.entryPrice,
            position.buySell,
            Timestamp.of(nextCandle.openTime.toDate()),
          );
          position.close(exitResult, simResult);
          // 複利: 決済損益を equity に反映
          if (params.equityState) {
            const pnlPips = Number(position.profitLoss!.toString());
            const lot = Number(position.lot.toString());
            params.equityState.equity += pnlPips * pipValuePerLotJpy(pair) * lot;
          }
          trades.push(buildTradeRecord({
            position,
            runId: params.runId,
            tradeSeq: tradeSeq++,
            extremes: extremes ? {
              highest: extremes.highest,
              lowest: extremes.lowest,
              mfeTime: currentCandle.closeTime.toDate(),
              maeTime: currentCandle.closeTime.toDate(),
            } : null,
            capitalAtEntry: capitalAtEntryMap.get(posId) ?? params.initialCapital,
            slippagePips: 0,
            equityAfter: params.equityState?.equity ?? params.initialCapital,
            pair,
            atrAtEntry: null,
          }));
          positions.delete(posId);
          extremeTracker.remove(posId);
          capitalAtEntryMap.delete(posId);
        }
      }

      // エントリー判定
      if (positions.size === 0) {
        const entryResult = entryRule.shouldEntry(snapshot);
        if (entryResult instanceof EntryCommand) {
          const simResult = executionSimulator.simulateEntry(
            entryResult,
            nextCandle.open,
            pair,
            Timestamp.of(nextCandle.openTime.toDate()),
          );
          const position = Position.open(entryResult, simResult);
          positions.set(position.id.toString(), position);
          capitalAtEntryMap.set(position.id.toString(), params.equityState?.equity ?? params.initialCapital);
        }
      }
    }

    // 未決済ポジションの強制クローズ
    const finalCandle = candles[candles.length - 1]!;
    for (const [posId, position] of positions) {
      extremeTracker.updateOhlc(posId, finalCandle.high, finalCandle.low);
      const extremes = extremeTracker.get(posId);
      if (extremes) {
        position.applyExtremes(extremes.highest, extremes.lowest);
      }
      const exitCommand = ExitCommand.of({
        positionId: position.id,
        type: ExitType.FORCE_CLOSE,
        reason: ExitReason.of('BT 期間終了'),
      });
      const simResult = executionSimulator.simulateExit(
        exitCommand,
        finalCandle.close,
        pair,
        position.entryPrice,
        position.buySell,
        Timestamp.of(finalCandle.closeTime.toDate()),
      );
      position.close(exitCommand, simResult);
      if (params.equityState) {
        const pnlPips = Number(position.profitLoss!.toString());
        const lot = Number(position.lot.toString());
        params.equityState.equity += pnlPips * pipValuePerLotJpy(pair) * lot;
      }
      trades.push(buildTradeRecord({
        position,
        runId: params.runId,
        tradeSeq: tradeSeq++,
        extremes: extremes ? {
          highest: extremes.highest,
          lowest: extremes.lowest,
          mfeTime: finalCandle.closeTime.toDate(),
          maeTime: finalCandle.closeTime.toDate(),
        } : null,
        capitalAtEntry: capitalAtEntryMap.get(posId) ?? params.initialCapital,
        slippagePips: 0,
        equityAfter: params.equityState?.equity ?? params.initialCapital,
        pair,
        atrAtEntry: null,
      }));
      extremeTracker.remove(posId);
    }
    positions.clear();

    return calculate({
      runId: params.runId,
      batchId: params.batchId,
      pair,
      timeframe,
      strategy: params.strategy,
      params: params.params,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      trades,
      durationMs: Date.now() - startTime,
      initialCapital: params.initialCapital,
      engineMode: params.engineMode,
      executionConfig: params.executionConfig,
      codeVersion: params.codeVersion,
      tickCount: 0,
      barCount,
      gapCount: 0,
      dataHash: '',
      sampleType: params.sampleType ?? SampleType.FULL,
      foldNumber: params.foldNumber ?? null,
    });
  }
}

function makeTick(price: Price, pair: CurrencyPair, candle: ConfirmedCandle): Tick {
  const unit = pipUnit(pair).toNumber();
  const priceNum = Number(price.toString());
  const ask = Price.of((priceNum + unit).toFixed(6));
  return Tick.of(ask, price, TickTimestamp.of(candle.closeTime.toDate()));
}
