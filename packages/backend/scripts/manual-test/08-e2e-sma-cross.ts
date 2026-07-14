/**
 * E2E検証: SMAクロス検知 → UiNotifier通知 → エントリー可能
 *
 * モック tick を注入して意図的にゴールデンクロスを発生させる。
 * 実際の GMO API は使わない。全てローカルで完結する。
 *
 * 実行: node --env-file=.env --import tsx scripts/manual-test/08-e2e-sma-cross.ts
 */
import { CurrencyPair } from '../../src/domain/market/CurrencyPair.js';
import { IndicatorConfig } from '../../src/domain/market/indicator/IndicatorConfig.js';
import { TimeFrameBook } from '../../src/domain/market/TimeFrameBook.js';
import { TradingSignalsSmaCalculatorFactory } from '../../src/adapter/indicator/TradingSignalsSmaCalculator.js';
import { MarketDataStream } from '../../src/infrastructure/MarketDataStream.js';
import { TradingSession } from '../../src/application/TradingSession.js';
import { SmaCrossEntryRule } from '../../src/domain/rule/sma-cross/SmaCrossEntryRule.js';
import { SmaCrossExitRule } from '../../src/domain/rule/sma-cross/SmaCrossExitRule.js';
import { Lot } from '../../src/domain/position/Lot.js';
import { Price } from '../../src/domain/market/Price.js';
import { Tick } from '../../src/domain/market/tick/Tick.js';
import { TickTimestamp } from '../../src/domain/market/tick/TickTimestamp.js';
import { ConfirmedCandle } from '../../src/domain/market/candle/ConfirmedCandle.js';
import { CandleOpenTime } from '../../src/domain/market/candle/CandleOpenTime.js';
import { CandleCloseTime } from '../../src/domain/market/candle/CandleCloseTime.js';
import { TimeFrame, LIVE_TIMEFRAMES, durationMs } from '../../src/domain/market/TimeFrame.js';
import { EntryCommand } from '../../src/domain/command/EntryCommand.js';
import { DoNothing } from '../../src/domain/command/DoNothing.js';
import type { MarketDataPort } from '../../src/port/MarketDataPort.js';
import type { Broker } from '../../src/port/Broker.js';
import type { PositionRepository } from '../../src/port/PositionRepository.js';
import type { CandleHistoryPort } from '../../src/port/CandleHistoryPort.js';
import type { UiNotifier } from '../../src/port/UiNotifier.js';
import type { EntryResult } from '../../src/domain/market/EntryResult.js';
import type { ExitResult } from '../../src/domain/market/ExitResult.js';
import type { Position } from '../../src/domain/position/Position.js';
import type { PositionId } from '../../src/domain/position/PositionId.js';
import { OpenPositions } from '../../src/domain/position/OpenPositions.js';
import { EntryExecution } from '../../src/action/EntryExecution.js';
import { ExitExecution } from '../../src/action/ExitExecution.js';

const PAIR = CurrencyPair('USD_JPY');
const SMA_SHORT = 5;
const SMA_LONG = 25;

// === モック Port ===

/** tick を手動で流せる MarketDataPort */
class MockMarketDataPort implements MarketDataPort {
  private listener: ((tick: Tick) => void) | null = null;
  async connect() {}
  async disconnect() {}
  subscribe(onTick: (tick: Tick) => void) {
    this.listener = onTick;
    return () => { this.listener = null; };
  }
  emit(tick: Tick) {
    this.listener?.(tick);
  }
}

/** 通知を記録する UiNotifier */
class RecordingUiNotifier implements UiNotifier {
  readonly events: { type: string; data: unknown }[] = [];
  async notifyEntryReady(command: EntryCommand) {
    this.events.push({ type: 'entry:ready', data: { side: command.buySell, pair: command.pair } });
    console.log(`  📢 entry:ready → ${command.buySell} ${command.pair} (${command.reason})`);
  }
  async notifyEntryExpired(command: EntryCommand) {
    this.events.push({ type: 'entry:expired', data: { side: command.buySell } });
    console.log(`  📢 entry:expired → ${command.buySell}`);
  }
  async notifyExitExecuted(command: unknown) {
    this.events.push({ type: 'exit:executed', data: command });
    console.log(`  📢 exit:executed`);
  }
}

/** 何もしない Broker（エントリーは手動なので呼ばれない想定） */
const mockBroker: Broker = {
  async placeEntry(_cmd: EntryCommand): Promise<EntryResult> { throw new Error('mockBroker: placeEntry は呼ばれないはず'); },
  async placeExit(_pos: Position): Promise<ExitResult> { throw new Error('mockBroker: placeExit は呼ばれないはず'); },
};

const mockRepo: PositionRepository = {
  async register() {},
  async update() {},
  async findById(_id: PositionId) { throw new Error('not found'); },
  async openPositions() { return OpenPositions.empty(); },
};

// === ウォームアップ用のローソク足を生成 ===

function makeCandles(
  basePrice: number,
  count: number,
  timeFrame: TimeFrame,
  startTime: Date,
): ConfirmedCandle[] {
  const candles: ConfirmedCandle[] = [];
  const dur = durationMs(timeFrame);
  for (let i = 0; i < count; i++) {
    const open = basePrice + (Math.random() - 0.5) * 0.1;
    const close = open + (Math.random() - 0.5) * 0.05;
    const high = Math.max(open, close) + Math.random() * 0.02;
    const low = Math.min(open, close) - Math.random() * 0.02;
    const openTime = new Date(startTime.getTime() + i * dur);
    const closeTime = new Date(openTime.getTime() + dur - 1);
    candles.push(ConfirmedCandle.of({
      open: Price.of(open.toFixed(3)),
      high: Price.of(high.toFixed(3)),
      low: Price.of(low.toFixed(3)),
      close: Price.of(close.toFixed(3)),
      openTime: CandleOpenTime.of(openTime),
      closeTime: CandleCloseTime.of(closeTime),
      timeFrame,
    }));
  }
  return candles;
}

// === 実行 ===

async function main() {
  console.log('=== E2E検証: SMAクロス検知 ===\n');

  // Step 1: 部品の組み立て
  const config = IndicatorConfig.of({ shortSmaPeriod: SMA_SHORT, longSmaPeriod: SMA_LONG });
  const factory = new TradingSignalsSmaCalculatorFactory();
  const timeFrameBook = new TimeFrameBook(PAIR, config, factory);
  const mockPort = new MockMarketDataPort();
  const uiNotifier = new RecordingUiNotifier();

  const entryExecution = new EntryExecution(mockBroker, mockRepo);
  const exitExecution = new ExitExecution(mockBroker, mockRepo);

  const marketDataStream = new MarketDataStream(
    mockPort,
    timeFrameBook,
    (snapshot) => {
      session.onMarketData(snapshot).catch((err) => console.error('onMarketData error:', err));
    },
  );

  const mockCandleHistory: CandleHistoryPort = {
    async fetchRecent() { return []; },
  };

  const session = new TradingSession(
    [new SmaCrossEntryRule(Lot.of(100))],
    [new SmaCrossExitRule()],
    entryExecution,
    exitExecution,
    mockRepo,
    uiNotifier,
    timeFrameBook,
    marketDataStream,
    mockCandleHistory,
  );

  // Step 2: ウォームアップ（低い価格で安定。短期SMA < 長期SMA の状態を作る）
  console.log('Step 1: ウォームアップ（短期SMA < 長期SMAの状態を構築）');
  const baseTime = new Date(Date.now() - 200 * 60_000);
  for (const tf of LIVE_TIMEFRAMES) {
    // 長期SMAが高い状態: 最初の20本は150.5、後の80本は150.0
    const candles = [
      ...makeCandles(150.5, 20, tf, baseTime),
      ...makeCandles(150.0, 80, tf, new Date(baseTime.getTime() + 20 * durationMs(tf))),
    ];
    timeFrameBook.warmUp(tf, candles);
  }

  // MarketDataStream を接続
  await marketDataStream.start();

  // Step 3: 低い tick を送って安定させる（短期SMA < 長期SMA を確定）
  console.log('Step 2: 低い tick を送信して短期SMA < 長期SMAを確定');
  // 過去のタイムスタンプを使う（ウォームアップの続きから）
  let tickTime = Date.now() - 60_000 * 5; // 5分前から開始
  for (let i = 0; i < 10; i++) {
    const price = (149.9 + Math.random() * 0.05).toFixed(3);
    const tick = Tick.of(
      Price.of(price),
      Price.of((Number(price) - 0.005).toFixed(3)),
      TickTimestamp.of(new Date(tickTime + i * 6500)),
    );
    mockPort.emit(tick);
  }

  // Rule の判定結果を確認
  tickTime += 70_000;
  const oneMinSnap1 = timeFrameBook.onTick(
    Tick.of(Price.of('149.950'), Price.of('149.945'), TickTimestamp.of(new Date(tickTime))),
  );
  const rule = new SmaCrossEntryRule(Lot.of(100));
  const result1 = rule.shouldEntry(oneMinSnap1);
  console.log(`  Rule判定（低い状態）: ${result1 instanceof DoNothing ? 'DoNothing ✅' : 'EntryCommand ❌'}`);

  // Step 4: 価格を急上昇させてゴールデンクロスを発生させる
  console.log('\nStep 3: 価格を急上昇させてゴールデンクロスを誘発');
  tickTime += 10_000;
  for (let i = 0; i < 30; i++) {
    const price = (150.5 + i * 0.02 + Math.random() * 0.01).toFixed(3);
    const tick = Tick.of(
      Price.of(price),
      Price.of((Number(price) - 0.005).toFixed(3)),
      TickTimestamp.of(new Date(tickTime + i * 6500)),
    );
    mockPort.emit(tick);
  }

  await new Promise(r => setTimeout(r, 100));

  // entry:ready と entry:expired の交互発生を確認
  console.log('\n=== イベントの時系列 ===');
  for (const ev of uiNotifier.events) {
    console.log(`  ${ev.type} ${JSON.stringify(ev.data)}`);
  }

  console.log(`\n=== 結果 ===`);
  console.log(`UiNotifier イベント数: ${uiNotifier.events.length}`);
  for (const ev of uiNotifier.events) {
    console.log(`  ${ev.type}: ${JSON.stringify(ev.data)}`);
  }

  const hasEntryReady = uiNotifier.events.some(e => e.type === 'entry:ready');
  console.log(`\n${hasEntryReady ? '✅ ゴールデンクロス検知 → entry:ready 通知成功!' : '❌ entry:ready 通知が来なかった'}`);

  await marketDataStream.stop();
}

main().catch(console.error);
