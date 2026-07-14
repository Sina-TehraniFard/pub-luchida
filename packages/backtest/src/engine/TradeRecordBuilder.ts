import type { Position } from '@luchida/backend/domain/position/Position.js';
import type { Price } from '@luchida/backend/domain/market/Price.js';
import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { pipValuePerLotJpy } from '@luchida/backend/domain/market/PipUnit.js';
import type { TradeRecord } from '../result/TradeRecord.js';

/**
 * buildTradeRecord の入力。
 * Engine が持つ文脈情報を明示的に渡す。
 */
export interface TradeRecordInput {
  readonly position: Position;
  readonly runId: string;
  readonly tradeSeq: number;
  readonly extremes: {
    readonly highest: Price;
    readonly lowest: Price;
    readonly mfeTime: Date;
    readonly maeTime: Date;
  } | null;
  readonly capitalAtEntry: number;
  readonly slippagePips: number;
  readonly equityAfter: number;
  readonly pair: CurrencyPair;
  readonly atrAtEntry: number | null;
}

/**
 * Position を TradeRecord に変換する純粋関数。
 *
 * OhlcEngine と TickEngine の両方で使う共通ロジック。
 */
export function buildTradeRecord(input: TradeRecordInput): TradeRecord {
  const { position, runId, tradeSeq, capitalAtEntry, slippagePips, equityAfter, pair, atrAtEntry } = input;
  const entryTime = position.openedAt.toDate();
  const exitTime = position.closedAt!.toDate();
  const pnlPips = Number(position.profitLoss!.toString());
  const lot = Number(position.lot.toString());
  const pnlAmount = pnlPips * pipValuePerLotJpy(pair) * lot;

  return {
    id: position.id.toString(),
    runId,
    tradeSeq,
    side: position.buySell,
    entryTime,
    exitTime,
    entryPrice: Number(position.entryPrice.toString()),
    exitPrice: Number(position.exitPrice!.toString()),
    lot,
    pnl: pnlPips,
    pnlPips,
    pnlAmount,
    capitalAtEntry,
    mfe: Number(position.mfePips?.toString() ?? '0'),
    mfePips: Number(position.mfePips?.toString() ?? '0'),
    mfeTime: input.extremes?.mfeTime ?? exitTime,
    mae: Number(position.maePips?.toString() ?? '0'),
    maePips: Number(position.maePips?.toString() ?? '0'),
    maeTime: input.extremes?.maeTime ?? exitTime,
    atrAtEntry,
    holdingPeriodMs: exitTime.getTime() - entryTime.getTime(),
    exitType: position.exitType!,
    entryHourUtc: entryTime.getUTCHours(),
    entryDayOfWeek: entryTime.getUTCDay(),
    slippagePips,
    equityAfter,
  };
}
