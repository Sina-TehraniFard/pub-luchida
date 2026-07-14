import { Position } from '@luchida/backend/domain/position/Position.js';
import { ExtremeTracker } from '@luchida/backend/domain/position/ExtremeTracker.js';
import { ExitCommand, ExitType } from '@luchida/backend/domain/command/ExitCommand.js';
import { ExitReason } from '@luchida/backend/domain/command/ExitReason.js';
import { EntryCommand } from '@luchida/backend/domain/command/EntryCommand.js';
import { Price } from '@luchida/backend/domain/market/Price.js';
import { Timestamp } from '@luchida/backend/domain/market/Timestamp.js';
import { CandleAccumulator } from '@luchida/backend/domain/market/candle/CandleAccumulator.js';
import { opposite } from '@luchida/backend/domain/market/BuySell.js';
import { pipValuePerLotJpy } from '@luchida/backend/domain/market/PipUnit.js';
import type { Tick } from '@luchida/backend/domain/market/tick/Tick.js';
import { SampleType } from '../result/BacktestResult.js';
import type { BacktestResult } from '../result/BacktestResult.js';
import type { TradeRecord } from '../result/TradeRecord.js';
import type { Engine, EngineRunParams } from './Engine.js';
import type { PendingOrderManager } from './PendingOrderManager.js';
import { buildTradeRecord } from './TradeRecordBuilder.js';
import { calculate } from './ResultCalculator.js';

/**
 * tick ストリームベースの BT エンジン。
 *
 * 処理順序（毎 tick）:
 *   1. 足確定判定（CandleAccumulator）
 *   2. 足確定時: Rule 呼び出し → PendingOrderManager に注文を登録
 *   3. 約定判定（exit 優先 → entry）
 *   4. MFE/MAE 更新（tick 粒度の update のみ、updateOhlc は使わない）
 *
 * スプレッドは Dukascopy tick データに含まれる実 bid/ask で再現される。
 * スリッページと約定遅延は RealisticExecutionSimulator と PendingOrderManager が担う。
 */
export class TickEngine implements Engine {
  constructor(private readonly pendingOrders: PendingOrderManager) {}

  async run(params: EngineRunParams): Promise<BacktestResult> {
    const startTime = Date.now();
    const { config, entryRule, exitRule, dataProvider, snapshotAdapter, executionSimulator } = params;
    const { pair, timeframe, dateRange, warmupCount } = config;

    // warmUp: 確定足を使ってインジケーターを初期化する
    // warmupCount=0 の場合は足取得をスキップ（テスト等で許容）
    if (warmupCount > 0) {
      const warmupCandles = await dataProvider.fetchCandles(pair, timeframe, dateRange, warmupCount);
      if (warmupCandles.length < warmupCount) {
        throw new Error(
          `TickEngine: warmup に必要な足数が不足しています（必要: ${warmupCount}, 取得: ${warmupCandles.length}）`,
        );
      }
      snapshotAdapter.warmUp(warmupCandles.slice(0, warmupCount));
    } else {
      snapshotAdapter.warmUp([]);
    }

    const accumulator = new CandleAccumulator(timeframe);
    const positions = new Map<string, Position>();
    const extremeTracker = new ExtremeTracker();
    const trades: TradeRecord[] = [];
    const capitalAtEntryMap = new Map<string, number>();
    const pendingOrders = this.pendingOrders;
    let tradeSeq = 0;
    let tickCount = 0;

    let lastTick: Tick | null = null;

    for await (const tick of dataProvider.fetchTicks(pair, dateRange)) {
      lastTick = tick;
      tickCount++;

      if (params.marketState) {
        params.marketState.currentRate = Number(tick.bid().toString());
      }

      const event = accumulator.accumulate(tick);

      // 足確定時: Rule 呼び出し → 注文登録
      if (event.type === 'CONFIRMED') {
        const confirmed = accumulator.lastConfirmed();
        if (confirmed !== null) {
          // nextCandleOpen は tick.bid() で近似（設計書 m-3 参照）
          const snapshot = snapshotAdapter.addCandleAndBuild(confirmed, tick, tick.bid());

          // 決済判定（エントリーより先 — ドテン対応）
          for (const [, position] of positions) {
            const exitResult = exitRule.shouldExit(snapshot, position);
            if (exitResult instanceof ExitCommand) {
              pendingOrders.acceptExitOrder(exitResult, position, tick);
            }
          }

          // エントリー判定: ポジションなし かつ pending もなし
          if (positions.size === 0 && !pendingOrders.hasAnyPending()) {
            const entryResult = entryRule.shouldEntry(snapshot);
            if (entryResult instanceof EntryCommand) {
              pendingOrders.acceptEntryOrder(entryResult, tick);
            }
          }
        }
      }

      // 毎 tick: 約定判定（exit を先、entry を後）
      const fillExit = pendingOrders.checkExitFill(tick);
      if (fillExit !== null) {
        const { command, position } = fillExit;
        const executionPrice = selectPrice(tick, opposite(position.buySell));
        const extremes = extremeTracker.get(position.id.toString());
        if (extremes) {
          position.applyExtremes(extremes.highest, extremes.lowest);
        }
        const simResult = executionSimulator.simulateExit(
          command,
          executionPrice,
          pair,
          position.entryPrice,
          position.buySell,
          Timestamp.of(tick.timestamp().toDate()),
        );
        position.close(command, simResult);
        if (params.equityState) {
          const pnlPips = Number(position.profitLoss!.toString());
          const lot = Number(position.lot.toString());
          params.equityState.equity += pnlPips * pipValuePerLotJpy(pair) * lot;
        }
        const posId = position.id.toString();
        trades.push(buildTradeRecord({
          position,
          runId: params.runId,
          tradeSeq: tradeSeq++,
          extremes: extremes ? {
            highest: extremes.highest,
            lowest: extremes.lowest,
            mfeTime: tick.timestamp().toDate(),
            maeTime: tick.timestamp().toDate(),
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

      const fillEntry = pendingOrders.checkEntryFill(tick);
      if (fillEntry !== null) {
        const { command } = fillEntry;
        const executionPrice = selectPrice(tick, command.buySell);
        const simResult = executionSimulator.simulateEntry(
          command,
          executionPrice,
          pair,
          Timestamp.of(tick.timestamp().toDate()),
        );
        const position = Position.open(command, simResult);
        positions.set(position.id.toString(), position);
        capitalAtEntryMap.set(position.id.toString(), params.equityState?.equity ?? params.initialCapital);
      }

      // tick 粒度の MFE/MAE 追跡（updateOhlc は使わない — 設計書 m-4 参照）
      for (const [posId, position] of positions) {
        extremeTracker.update(posId, tick.bid(), tick.ask(), position.buySell);
      }
    }

    // ストリーム終了時: 保留中エグジットを finalTick 価格で解決
    if (lastTick !== null) {
      const settlement = pendingOrders.settleAtStreamEnd(lastTick);
      if (settlement.exitFill !== null) {
        const { command, position } = settlement.exitFill;
        const executionPrice = selectPrice(lastTick, opposite(position.buySell));
        const extremes = extremeTracker.get(position.id.toString());
        if (extremes) {
          position.applyExtremes(extremes.highest, extremes.lowest);
        }
        const simResult = executionSimulator.simulateExit(
          command,
          executionPrice,
          pair,
          position.entryPrice,
          position.buySell,
          Timestamp.of(lastTick.timestamp().toDate()),
        );
        position.close(command, simResult);
        if (params.equityState) {
          const pnlPips = Number(position.profitLoss!.toString());
          const lot = Number(position.lot.toString());
          params.equityState.equity += pnlPips * pipValuePerLotJpy(pair) * lot;
        }
        const posId = position.id.toString();
        trades.push(buildTradeRecord({
          position,
          runId: params.runId,
          tradeSeq: tradeSeq++,
          extremes: extremes ? {
            highest: extremes.highest,
            lowest: extremes.lowest,
            mfeTime: lastTick.timestamp().toDate(),
            maeTime: lastTick.timestamp().toDate(),
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

    // 未決済ポジションの強制クローズ
    if (lastTick !== null) {
      for (const [posId, position] of positions) {
        const extremes = extremeTracker.get(posId);
        if (extremes) {
          position.applyExtremes(extremes.highest, extremes.lowest);
        }
        const exitCommand = ExitCommand.of({
          positionId: position.id,
          type: ExitType.FORCE_CLOSE,
          reason: ExitReason.of('BT 期間終了'),
        });
        const executionPrice = selectPrice(lastTick, opposite(position.buySell));
        const simResult = executionSimulator.simulateExit(
          exitCommand,
          executionPrice,
          pair,
          position.entryPrice,
          position.buySell,
          Timestamp.of(lastTick.timestamp().toDate()),
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
            mfeTime: lastTick.timestamp().toDate(),
            maeTime: lastTick.timestamp().toDate(),
          } : null,
          capitalAtEntry: capitalAtEntryMap.get(posId) ?? params.initialCapital,
          slippagePips: 0,
          equityAfter: params.equityState?.equity ?? params.initialCapital,
          pair,
          atrAtEntry: null,
        }));
        extremeTracker.remove(posId);
      }
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
      tickCount,
      barCount: 0,
      gapCount: 0,
      dataHash: '',
      sampleType: params.sampleType ?? SampleType.FULL,
      foldNumber: params.foldNumber ?? null,
    });
  }
}

/**
 * 売買方向から約定価格を選択する。
 * BUY（買い）は ask で、SELL（売り）は bid で約定する。
 */
function selectPrice(tick: Tick, buySell: Parameters<typeof opposite>[0]): Price {
  return buySell === 'BUY' ? tick.ask() : tick.bid();
}
