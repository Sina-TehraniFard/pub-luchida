import { describe, it, expect } from 'vitest';

import { Price } from '@luchida/backend/domain/market/Price.js';
import { Timestamp } from '@luchida/backend/domain/market/Timestamp.js';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { EntryCommand } from '@luchida/backend/domain/command/EntryCommand.js';
import { ExitCommand, ExitType } from '@luchida/backend/domain/command/ExitCommand.js';
import { EntryReason } from '@luchida/backend/domain/command/EntryReason.js';
import { ExitReason } from '@luchida/backend/domain/command/ExitReason.js';
import { ConvictionScore } from '@luchida/backend/domain/market/ConvictionScore.js';
import { EntrySnapshot } from '@luchida/backend/domain/market/snapshot/EntrySnapshot.js';
import { Lot } from '@luchida/backend/domain/position/Lot.js';
import { Money } from '@luchida/backend/domain/Money.js';
import { PositionId } from '@luchida/backend/domain/position/PositionId.js';
import { StrategyName } from '@luchida/backend/domain/rule/StrategyName.js';

import { SeededRandom } from './SeededRandom.js';
import { SlippageModel } from './SlippageModel.js';
import { RealisticExecutionSimulator } from './RealisticExecutionSimulator.js';

const pair = CurrencyPair('USD_JPY');
const JPY_PIP_UNIT = 0.01;

function makeEntryCommand(buySell: 'BUY' | 'SELL'): EntryCommand {
  return EntryCommand.of({
    pair,
    buySell,
    lot: Lot.of(1000),
    reason: EntryReason.of('テスト'),
    convictionScore: ConvictionScore.of('0.7'),
    strategyName: StrategyName.SMA_CROSS,
    entrySnapshot: EntrySnapshot.of({ convictionScore: '0.7', entryHour: 10, entryDayOfWeek: 1 }),
    requiredMargin: Money.jpy('0'),
  });
}

function makeExitCommand(): ExitCommand {
  return ExitCommand.of({
    positionId: PositionId.from('test-pos'),
    type: ExitType.TAKE_PROFIT,
    reason: ExitReason.of('テスト決済'),
  });
}

function makeTs(date: Date = new Date('2024-01-01T00:00:00Z')): Timestamp {
  return Timestamp.of(date);
}

/**
 * 0 ではなく非常に小さな stddev を使い、スリッページが発生するが
 * 価格が 0 以下にならないことを保証するシミュレーターを返す
 */
function makeSimulator(seed: number, stddevPips = '0.3'): RealisticExecutionSimulator {
  const rng = new SeededRandom(seed);
  const slippage = new SlippageModel(Number(stddevPips), rng, JPY_PIP_UNIT);
  return new RealisticExecutionSimulator(slippage);
}

describe('RealisticExecutionSimulator', () => {
  it('BUY エントリーでスリッページが不利方向（ask 価格より高く）に適用される', () => {
    // BUY エントリーは ask で執行し、スリッページは上方向（不利）
    // → 結果の entryPrice >= ask (executionPrice)
    const sim = makeSimulator(100);
    const ask = Price.of('150.050');

    const results = Array.from({ length: 50 }, () =>
      sim.simulateEntry(makeEntryCommand('BUY'), ask, pair, makeTs()),
    );

    const askNum = Number(ask.toString());
    for (const result of results) {
      expect(Number(result.entryPrice.toString())).toBeGreaterThanOrEqual(askNum);
    }
  });

  it('SELL エントリーでスリッページが不利方向（bid 価格より低く）に適用される', () => {
    // SELL エントリーは bid で執行し、スリッページは下方向（不利）
    // → 結果の entryPrice <= bid (executionPrice)
    const sim = makeSimulator(200);
    const bid = Price.of('150.000');

    const results = Array.from({ length: 50 }, () =>
      sim.simulateEntry(makeEntryCommand('SELL'), bid, pair, makeTs()),
    );

    const bidNum = Number(bid.toString());
    for (const result of results) {
      expect(Number(result.entryPrice.toString())).toBeLessThanOrEqual(bidNum);
    }
  });

  it('BUY 決済でスリッページが不利方向（BUY決済はSELL方向なので bid 価格より低く）', () => {
    // BUY ポジションの決済は SELL 方向 → bid が執行基準
    // スリッページは SELL 方向（下）に適用 → 結果の exitPrice <= bid (executionPrice)
    const sim = makeSimulator(300);
    const bid = Price.of('150.100');
    const entryPrice = Price.of('150.000');

    const results = Array.from({ length: 50 }, () =>
      sim.simulateExit(makeExitCommand(), bid, pair, entryPrice, 'BUY', makeTs()),
    );

    const bidNum = Number(bid.toString());
    for (const result of results) {
      expect(Number(result.exitPrice.toString())).toBeLessThanOrEqual(bidNum);
    }
  });

  it('SELL 決済でスリッページが不利方向（SELL決済はBUY方向なので ask 価格より高く）', () => {
    // SELL ポジションの決済は BUY 方向 → ask が執行基準
    // スリッページは BUY 方向（上）に適用 → 結果の exitPrice >= ask (executionPrice)
    const sim = makeSimulator(400);
    const ask = Price.of('150.050');
    const entryPrice = Price.of('150.200');

    const results = Array.from({ length: 50 }, () =>
      sim.simulateExit(makeExitCommand(), ask, pair, entryPrice, 'SELL', makeTs()),
    );

    const askNum = Number(ask.toString());
    for (const result of results) {
      expect(Number(result.exitPrice.toString())).toBeGreaterThanOrEqual(askNum);
    }
  });
});
