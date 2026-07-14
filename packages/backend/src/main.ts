/**
 * Composition Root — 全ての依存関係を組み立てて起動する。
 *
 * 実行: node --env-file=.env --import tsx src/main.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { CurrencyPair } from './domain/market/CurrencyPair.js';
import { BrokerError } from './domain/error/BrokerError.js';
import { AuthFailureCircuitBreaker } from './domain/guard/AuthFailureCircuitBreaker.js';
import { AuthFailureThreshold } from './domain/guard/AuthFailureThreshold.js';
import { ExitFailureCircuitBreaker } from './domain/guard/ExitFailureCircuitBreaker.js';
import { ExitFailureThreshold } from './domain/guard/ExitFailureThreshold.js';
import { IndicatorConfig } from './domain/market/indicator/IndicatorConfig.js';
import { TimeFrameBook } from './domain/market/TimeFrameBook.js';
import { TimeFrame } from './domain/market/TimeFrame.js';
import { TradingSignalsSmaCalculatorFactory } from './adapter/indicator/TradingSignalsSmaCalculator.js';
import { GmoRestClient } from './adapter/gmo/GmoRestClient.js';
import { GmoWebSocketClient } from './adapter/gmo/GmoWebSocketClient.js';
import { GmoMarketDataAdapter } from './adapter/gmo/GmoMarketDataAdapter.js';
import { GmoCandleHistoryAdapter } from './adapter/gmo/GmoCandleHistoryAdapter.js';
import { GmoBrokerAdapter } from './adapter/gmo/GmoBrokerAdapter.js';
import { createDatabase } from './infrastructure/database/connection.js';
import { DatabaseHealthCheck } from './infrastructure/database/DatabaseHealthCheck.js';
import { PostgresPositionRepository } from './infrastructure/database/PostgresPositionRepository.js';
import { MarketDataStream } from './infrastructure/MarketDataStream.js';
import { ExpressServer } from './infrastructure/server/ExpressServer.js';
import { SocketIoUiNotifier } from './infrastructure/server/SocketIoUiNotifier.js';
import { SocketEntryDecisionObserver } from './infrastructure/server/SocketEntryDecisionObserver.js';
import { EntryExecution } from './action/EntryExecution.js';
import { EntryQueue } from './action/EntryQueue.js';
import { ExitExecution } from './action/ExitExecution.js';
import { ExitCompensationQueue } from './action/ExitCompensationQueue.js';
import { TradingSession } from './application/TradingSession.js';
import { SyncPositionsUseCase } from './application/SyncPositionsUseCase.js';
import { EmergencyCloseAllUseCase } from './application/EmergencyCloseAllUseCase.js';
import { PositionManager } from './application/PositionManager.js';
import { ExitDispatcher } from './application/ExitDispatcher.js';
import { PositionExtremesUpdater } from './application/PositionExtremesUpdater.js';
import { ExitRuleRegistry } from './domain/rule/ExitRuleRegistry.js';
import { StrategyName } from './domain/rule/StrategyName.js';
import { EqualWeightAllocationPolicy } from './domain/allocation/EqualWeightAllocationPolicy.js';
import { SmaCrossEntryRule } from './domain/rule/sma-cross/SmaCrossEntryRule.js';
import { SmaCrossExitRule } from './domain/rule/sma-cross/SmaCrossExitRule.js';
import { FixedStopLossExitRule } from './domain/rule/shared/FixedStopLossExitRule.js';
import { TrailingTakeProfitExitRule } from './domain/rule/shared/TrailingTakeProfitExitRule.js';
import { TimedExitRule } from './domain/rule/shared/TimedExitRule.js';
import { TimeFilteredEntryRule } from './domain/rule/shared/TimeFilteredEntryRule.js';
import { CrossStrengthFilterEntryRule } from './domain/rule/shared/CrossStrengthFilterEntryRule.js';
import { SmaDivergenceFilterEntryRule } from './domain/rule/shared/SmaDivergenceFilterEntryRule.js';
import { TimeWindowBlockEntryRule } from './domain/rule/shared/TimeWindowBlockEntryRule.js';
import { PriceBandFilterEntryRule } from './domain/rule/shared/PriceBandFilterEntryRule.js';
import { MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW } from './domain/rule/shared/midMonthJstLunchNonBojWindow.js';
import { CompositeExitRule } from './domain/rule/shared/CompositeExitRule.js';
import { MaintenanceRatioBasedLotPolicy } from './domain/position/MaintenanceRatioBasedLotPolicy.js';
import { MaintenanceRatio } from './domain/position/MaintenanceRatio.js';
import { Balance } from './domain/Balance.js';
import { Money } from './domain/Money.js';
import { PositionSizingService } from './application/PositionSizingService.js';
import { GmoBalanceAdapter } from './adapter/gmo/GmoBalanceAdapter.js';
import { GmoConstants } from './adapter/gmo/GmoConstants.js';
import { MarketDataRateAdapter } from './infrastructure/MarketDataRateAdapter.js';
import { SystemClock } from './infrastructure/time/SystemClock.js';
import { BoundaryScheduler } from './infrastructure/BoundaryScheduler.js';
import { BarReconciler } from './application/BarReconciler.js';
import { durationMs } from './domain/market/TimeFrame.js';
import { Logger } from './infrastructure/logging/Logger.js';

const logger = new Logger('Main');

/**
 * 24時間以上前の古いログファイルを削除する。
 * nohup でリダイレクトした /tmp/luchida-bot-*.log の管理用。
 */
function cleanupOldLogs(): void {
  const logDir = '/tmp';
  const prefix = 'luchida-bot-';
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  try {
    const files = fs.readdirSync(logDir);
    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith('.log')) continue;
      const filePath = path.join(logDir, file);
      const stat = fs.statSync(filePath);
      const ageMs = now - stat.mtimeMs;
      if (ageMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        logger.info('古いログファイルを削除', { file, ageHours: parseFloat((ageMs / 3600_000).toFixed(1)) });
      }
    }
  } catch (err) {
    logger.warn('ログクリーンアップ中にエラー', { error: String(err) });
  }
}

// --- 戦略パラメータ（BT 検証済みベースライン: Phase 3 採用 4 フィルター反映） ---
const PAIR = CurrencyPair('USD_JPY');
const SMA_SHORT = 20;
const SMA_LONG = 100;
const STOP_LOSS_PIPS = 40;             // BT: SL40 (旧15は短すぎてノイズで損切り)
const TRAIL_ACTIVATE_PIPS = 150;       // BT: MFE150到達でトレーリング開始
const TRAIL_WIDTH_PIPS = 70;           // BT: MFE-70pips でストップを追いかける
const EXCLUDE_HOURS_UTC = [0, 7, 18];  // BT: 閑散時間帯を除外
const MAX_HOLD_BARS = 192;             // BT: 48時間で強制決済 (192本 × 15分 = 48h)
const TARGET_MAINTENANCE_RATIO = '1.40'; // Phase 3 採用: 維持率ベース Lot（140%）
const MIN_CROSS_STRENGTH_PIPS = 0.1;   // Phase 3 採用: クロス強度フィルター
const MAX_DIRECTIONAL_DIVERGENCE_PCT = 0.1; // Phase 3 採用: 方向別 SMA 乖離フィルター（WF 検証で 0.10% 最頑健）
const MIN_SELL_PRICE = 85;                  // v0.6.0 採用: 介入警戒圏（USD/JPY 85 円未満）での SELL を block
const TRADE_TIMEFRAME = TimeFrame.FIFTEEN_MINUTE;

// --- インフラ閾値（GmoBalanceAdapter / MarketDataRateAdapter / EntryQueue） ---
const BALANCE_CACHE_TTL_MS = 5_000;      // GmoBalanceAdapter の TTL
const RATE_MAX_AGE_MS = 5_000;           // RatePort.currentFresh の鮮度閾値
const BACKEND_PORT = 7778;
const ENTRY_QUEUE_TTL_MS = 3_000;        // EntryQueue: シグナル TTL（policies.md 3.5）
const ENTRY_QUEUE_DRAIN_INTERVAL_MS = 100; // EntryQueue: drain タイマー間隔
const AUTH_FAILURE_THRESHOLD = 3;        // #290 Step2: 連続認証失敗が何回で新規エントリーを抑止するか
const EXIT_FAILURE_COOLDOWN_TICKS = 30;  // #186: 決済失敗後、同一ポジションの再試行を止める tick 数
const EXIT_COMPENSATION_RETRY_INTERVAL_MS = 5_000; // #186: 補償キュー（DB 反映リトライ）の間隔

// --- BarBoundaryWatchdog（Issue #204: 壁時計で公式 klines と照合・訂正） ---
const RECONCILE_OFFSET_MS = 15_000;      // 足境界 + 15秒で発火（klines 反映待ちのバッファ）
const RECONCILE_BARS = 200;              // 照合で取得する確定足数（既存 warmUp と同数。SMA 丸ごと再構築に十分）
const RECONCILE_TIMEFRAMES = [
  TimeFrame.FIFTEEN_MINUTE,
  TimeFrame.ONE_HOUR,
  TimeFrame.ONE_DAY,
] as const;                              // 1分足は対象外（更新頻度が高すぎる）

// --- 環境変数バリデーション（インフラ生成より前に実施） ---
if (!process.env.CAPITAL) {
  throw new Error('CAPITAL 環境変数が未設定です。BalancePort.current() / freshNow() が値を取れないとき PositionSizingService が fallback として参照します。JPY 整数で指定してください（例: CAPITAL=100000）');
}
if (!/^[1-9]\d*$/.test(process.env.CAPITAL)) {
  throw new Error(`CAPITAL は正の整数文字列で指定してください（0・指数表記・小数禁止）: ${process.env.CAPITAL}`);
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 環境変数が未設定です');
}
if (!process.env.GMO_API_KEY || !process.env.GMO_API_SECRET) {
  throw new Error('GMO_API_KEY / GMO_API_SECRET 環境変数が未設定です');
}
// #186: 同一ポジションの決済連続失敗が何回で kill-switch（セッション停止）を発動するか。
// 既定 25 の根拠: クールダウン 30 tick（活況時 ≈ 3 秒）× 25 回 ≈ 75 秒 > 定期 sync 間隔 60 秒。
// ゴーストポジション起因なら定期 sync に最低 1 回の修復機会を与えてから停止する。
const EXIT_FAILURE_KILL_SWITCH_THRESHOLD = process.env.EXIT_FAILURE_KILL_SWITCH_THRESHOLD ?? '25';
if (!/^[1-9]\d*$/.test(EXIT_FAILURE_KILL_SWITCH_THRESHOLD)) {
  throw new Error(`EXIT_FAILURE_KILL_SWITCH_THRESHOLD は 1 以上の整数文字列で指定してください: ${EXIT_FAILURE_KILL_SWITCH_THRESHOLD}`);
}
const CAPITAL_JPY = process.env.CAPITAL;
const DATABASE_URL = process.env.DATABASE_URL;
const GMO_API_KEY = process.env.GMO_API_KEY;
const GMO_API_SECRET = process.env.GMO_API_SECRET;

logger.info('API キー指紋', {
  apiKeyFingerprint: createHash('sha256').update(GMO_API_KEY).digest('hex').slice(0, 8),
});

// --- データベース ---
const { db, pool } = createDatabase(DATABASE_URL);
const positionRepository = new PostgresPositionRepository(db);
// 起動時 DB 健康度チェック（Issue #187）: openPositions() の前に DB へ ping を打ち、
// 一時的な接続断は exponential backoff（初期 1s / 倍率 2 / 最大 30s / 最大 5 リトライ）で吸収する。
// 各 ping には 5s の上限があり、pool.query が無限ブロックしても起動が止まらない。
const databaseHealthCheck = new DatabaseHealthCheck(
  async () => { await pool.query('SELECT 1'); },
  new Logger('DatabaseHealthCheck'),
);

// --- 時刻ポート（Adapter 等に注入） ---
const systemClock = new SystemClock();

// --- GMO FX API ---
const restClient = new GmoRestClient(GMO_API_KEY, GMO_API_SECRET);
const wsClient = new GmoWebSocketClient('wss://forex-api.coin.z.com/ws/public/v1');
const marketDataAdapter = new GmoMarketDataAdapter(wsClient, PAIR);
const candleHistoryAdapter = new GmoCandleHistoryAdapter(restClient, systemClock);
const broker = new GmoBrokerAdapter(restClient);

// --- ドメイン ---
const indicatorConfig = IndicatorConfig.of({
  shortSmaPeriod: SMA_SHORT,
  longSmaPeriod: SMA_LONG,
});
const smaCalculatorFactory = new TradingSignalsSmaCalculatorFactory();
const timeFrameBook = new TimeFrameBook(PAIR, indicatorConfig, smaCalculatorFactory, new Logger('TimeFrameBook', 'MARKET'));

// --- 認証失敗の停止回路（#290 Step2 / TradingGuard 原型） ---
// 定期 sync が認証成否を報告（報告口）し、PositionManager が新規エントリー可否を問う（関門口）。
// 同じ番人が両 port を実装する。Exit を問う口は持たない＝Exit は止まらない。
const authFailureCircuitBreaker = new AuthFailureCircuitBreaker(
  AuthFailureThreshold.of(AUTH_FAILURE_THRESHOLD),
  new Logger('AuthFailureCircuitBreaker', 'TRADE'),
);

// --- 決済連続失敗の停止回路（#186 / TradingGuard 原型） ---
// ExitDispatcher が試行結果を記録し、TradingSession が dispatch 後に kill 判定を問う。
// 同じ回路が両者に注入される（報告口と関門口を 1 インスタンスが担う）。
const exitFailureCircuitBreaker = new ExitFailureCircuitBreaker(
  ExitFailureThreshold.of(Number(EXIT_FAILURE_KILL_SWITCH_THRESHOLD)),
  EXIT_FAILURE_COOLDOWN_TICKS,
);

// --- UseCase（ExpressServer と定期 sync の共有ロジック） ---
const syncPositionsUseCase = new SyncPositionsUseCase(
  PAIR,
  broker,
  positionRepository,
  new Logger('SyncPositionsUseCase'),
  authFailureCircuitBreaker,
);
const emergencyCloseAllUseCase = new EmergencyCloseAllUseCase(
  broker,
  positionRepository,
  new Logger('EmergencyCloseAllUseCase', 'TRADE'),
);

// --- HTTP サーバー ---
// LOG_FILE は PM2（ecosystem.config.cjs）が出力先と同じ値を env で渡す。
// PM2 外での起動（開発時の直接実行）は stdout に出るだけなので fallback も同じパス。
const LOG_FILE_PATH = process.env.LOG_FILE ?? '/tmp/luchida-bot.log';
const server = new ExpressServer(
  BACKEND_PORT,
  positionRepository,
  restClient,
  syncPositionsUseCase,
  emergencyCloseAllUseCase,
  LOG_FILE_PATH,
);
const uiNotifier = new SocketIoUiNotifier(server.io);

// --- アクション ---
const entryExecution = new EntryExecution(broker, positionRepository);
// #186: 部分成功（broker 決済成功 + DB 反映失敗）の補償キュー。
// ExitExecution が enqueue し、ExitDispatcher が has() でシールド判定する。
// lifecycle は main が持つ（kill-switch でセッションが止まっても DB 補修は続けるため、
// TradingSession の start/stop に紐付けない）。
const exitCompensationQueue = new ExitCompensationQueue(
  positionRepository,
  new Logger('ExitCompensationQueue', 'TRADE'),
  { retryIntervalMs: EXIT_COMPENSATION_RETRY_INTERVAL_MS },
);
const exitExecution = new ExitExecution(
  broker,
  positionRepository,
  exitCompensationQueue,
  new Logger('ExitExecution', 'TRADE'),
);

// --- Lot サイジング（PositionSizingService 経由） ---

// --- EntryQueue（policies.md 3 章: FIFO + TTL 3 秒 + 排他 drain） ---
// TradingSession.start / stop の中で start() / stop() を呼ぶ配線。
const entryQueue = new EntryQueue(
  entryExecution,
  systemClock,
  new Logger('EntryQueue', 'TRADE'),
  uiNotifier,
  { ttlMs: ENTRY_QUEUE_TTL_MS, drainIntervalMs: ENTRY_QUEUE_DRAIN_INTERVAL_MS },
);
const balancePort = new GmoBalanceAdapter(restClient, systemClock, BALANCE_CACHE_TTL_MS);
const ratePort = new MarketDataRateAdapter(marketDataAdapter, PAIR, systemClock, RATE_MAX_AGE_MS);
ratePort.start();

const lotPolicy = new MaintenanceRatioBasedLotPolicy();
const fallbackBalance = Balance.of(Money.jpy(CAPITAL_JPY));
const sizingService = new PositionSizingService(
  balancePort,
  ratePort,
  lotPolicy,
  fallbackBalance,
  MaintenanceRatio.of(TARGET_MAINTENANCE_RATIO),
  GmoConstants.MARGIN_RATE,
);

// --- ルール（Phase 3 採用 4 フィルター: クロス強度 → SMA 乖離 → 月中 JST 昼 → 時間帯フィルタ、RuleFactory と同順序） ---
// SmaCrossEntryRule に渡すサイジング closure。
// PositionSizingService.executeSizing が SizingResult（lot / rate / requiredMargin）を返す。
// EntryCommand.requiredMargin（policies.md 3.3.1 P10）は SizingResult.requiredMargin() から流用。
const baseEntryRule = new SmaCrossEntryRule(
  TRADE_TIMEFRAME,
  () => sizingService.executeSizing(PAIR),
);
const withCrossStrength = new CrossStrengthFilterEntryRule(baseEntryRule, TRADE_TIMEFRAME, MIN_CROSS_STRENGTH_PIPS);
const withDivergence = new SmaDivergenceFilterEntryRule(withCrossStrength, TRADE_TIMEFRAME, MAX_DIRECTIONAL_DIVERGENCE_PCT);
const withPriceBand = new PriceBandFilterEntryRule(withDivergence, MIN_SELL_PRICE, null);
const withMidMonthJst = new TimeWindowBlockEntryRule(withPriceBand, [MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW]);
const entryRules = [
  new TimeFilteredEntryRule(withMidMonthJst, new Set(EXCLUDE_HOURS_UTC)),
];
const smaCrossExitRule = new CompositeExitRule([
  new FixedStopLossExitRule(STOP_LOSS_PIPS),
  new TrailingTakeProfitExitRule(TRAIL_ACTIVATE_PIPS, TRAIL_WIDTH_PIPS),
  new TimedExitRule(MAX_HOLD_BARS, durationMs(TRADE_TIMEFRAME)),
  new SmaCrossExitRule(TRADE_TIMEFRAME),
]);
const exitRuleRegistry = ExitRuleRegistry.of([
  [StrategyName.SMA_CROSS, smaCrossExitRule],
]);

// --- MarketDataStream ---
const marketDataStream = new MarketDataStream(
  marketDataAdapter,
  timeFrameBook,
  (snapshot) => {
    // Rate 取得は MarketDataRateAdapter が MarketDataPort.subscribe で別経路に保持。
    tradingSession.onMarketData(snapshot).catch((err) => {
      logger.error('onMarketData エラー', { error: String(err) });
    });
  },
);

// --- PositionManager（Detect → Context → Allocate → Size → Cap → Enqueue / policies.md 1.4 / 1.4.1） ---
const allocationPolicy = new EqualWeightAllocationPolicy();
// エントリー判定の観測器（繋ぎ: GC/DC と各フィルタ結果を UI に流す。本番判定には干渉しない）
const entryDecisionObserver = new SocketEntryDecisionObserver(server.io, {
  timeFrame: TRADE_TIMEFRAME,
  minCrossStrengthPips: MIN_CROSS_STRENGTH_PIPS,
  maxDirectionalDivergencePct: MAX_DIRECTIONAL_DIVERGENCE_PCT,
  minSellPrice: MIN_SELL_PRICE,
  excludeHoursUtc: new Set(EXCLUDE_HOURS_UTC),
  blockedWindows: [MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW],
});

const positionManager = new PositionManager(
  entryRules,
  allocationPolicy,
  sizingService,
  entryQueue,
  positionRepository,
  balancePort,
  uiNotifier,
  systemClock,
  new Logger('PositionManager', 'TRADE'),
  entryDecisionObserver,
  authFailureCircuitBreaker,
);

// --- ExitDispatcher / PositionExtremesUpdater（Step 8 PR C 配線） ---
const positionExtremesUpdater = new PositionExtremesUpdater(positionRepository);
const exitDispatcher = new ExitDispatcher(
  exitRuleRegistry,
  positionRepository,
  exitExecution,
  uiNotifier,
  positionExtremesUpdater,
  new Logger('ExitDispatcher', 'TRADE'),
  exitCompensationQueue,
  exitFailureCircuitBreaker,
);

// --- BarBoundaryWatchdog（壁時計で公式値と照合・訂正 / Issue #204） ---
const barReconciler = new BarReconciler(
  candleHistoryAdapter,
  timeFrameBook,
  RECONCILE_BARS,
  new Logger('BarReconciler', 'MARKET'),
);
const boundaryScheduler = new BoundaryScheduler(
  systemClock,
  RECONCILE_TIMEFRAMES,
  RECONCILE_OFFSET_MS,
  (timeFrame) => barReconciler.reconcile(timeFrame),
);

// --- TradingSession ---
const tradingSession = new TradingSession(
  PAIR,
  positionManager,
  exitDispatcher,
  positionExtremesUpdater,
  entryQueue,
  timeFrameBook,
  marketDataStream,
  candleHistoryAdapter,
  exitFailureCircuitBreaker,
  uiNotifier,
  boundaryScheduler,
);

// --- 起動 ---
async function main() {
  cleanupOldLogs();

  logger.info(`Luchida 起動 ${PAIR} SMA(${SMA_SHORT}/${SMA_LONG}) SL${STOP_LOSS_PIPS} Trail${TRAIL_ACTIVATE_PIPS}±${TRAIL_WIDTH_PIPS} MaintenanceRatio(target=${TARGET_MAINTENANCE_RATIO})`, {
    pair: PAIR,
    smaShort: SMA_SHORT,
    smaLong: SMA_LONG,
    stopLossPips: STOP_LOSS_PIPS,
    trailActivatePips: TRAIL_ACTIVATE_PIPS,
    trailWidthPips: TRAIL_WIDTH_PIPS,
    excludeHoursUtc: EXCLUDE_HOURS_UTC,
    maxHoldBars: MAX_HOLD_BARS,
    targetMaintenanceRatio: TARGET_MAINTENANCE_RATIO,
    marginRate: GmoConstants.MARGIN_RATE.toString(),
    minCrossStrengthPips: MIN_CROSS_STRENGTH_PIPS,
    maxDirectionalDivergencePct: MAX_DIRECTIONAL_DIVERGENCE_PCT,
    minSellPrice: MIN_SELL_PRICE,
    excludeMidMonthJstLunchNonBoj: true,
    timeFrame: '15min',
    allocationPolicy: allocationPolicy.constructor.name,
    entryRulesCount: entryRules.length,
    exitRulesCount: exitRuleRegistry.registeredStrategies().size,
  });

  // 起動時 DB 健康度チェック（Issue #187）: openPositions() より前に DB 疎通を確かめる。
  // 一時的な接続断は backoff でリトライして吸収し、リトライ上限到達なら fail-fast する。
  // これにより DB throw（startup_db_unhealthy）を「集合不整合」の throw と区別する。
  await databaseHealthCheck.ensureHealthy();

  // 起動時 fail-fast 検証: 保有戦略集合が Registry 登録戦略集合の subset であること
  const openAtStartup = await positionRepository.openPositions();
  const heldStrategies = openAtStartup.heldStrategyNames();
  const registeredStrategies = exitRuleRegistry.registeredStrategies();
  const orphanedStrategies = [...heldStrategies].filter((s) => !registeredStrategies.has(s));
  if (orphanedStrategies.length > 0) {
    logger.error('ExitRuleRegistry に未登録の戦略を保有中', {
      event: 'startup_registry_mismatch',
      orphanedStrategies,
      registeredStrategies: [...registeredStrategies].sort(),
    });
    throw new Error(
      `ExitRuleRegistry に未登録の戦略を保有中: ${JSON.stringify(orphanedStrategies)}. ` +
      `起動を中止します（保有戦略には対応する ExitRule の登録が必要）。`,
    );
  }
  logger.info('ExitRuleRegistry 配線完了', {
    event: 'exit_rule_registry_loaded',
    strategies: [...registeredStrategies].sort(),
  });

  await server.start();
  logger.info(`HTTP サーバー :${BACKEND_PORT} 起動`, { port: BACKEND_PORT });

  // 起動時の接続性チェック（#290 / 出典: #287 の検知遅延 65 分）:
  // private API を 1 本叩いて正しく結線されているか確認する。「起動した」≠「正しい設定で起動した」。
  // 失敗なら原因（認証失敗・レート制限・通信断・想定外）に関わらず fail-fast（起動を中止）し、
  // 壊れた API キーのまま稼働し続けることを防ぐ。原因は BrokerError として区別されログに残る。
  // 注: 現状はどの失敗でも起動中止。レート制限など一過性の失敗に対するリトライ/様子見の
  // 線引きは #290 Step2（連続認証失敗の停止回路）で再設計する。
  try {
    await broker.verifyConnectivity();
    server.reportAuthStatus('ok');
    logger.info('起動時接続性チェック成功', { event: 'connectivity_check_ok' });
  } catch (err) {
    server.reportAuthStatus('failed');
    const code = err instanceof BrokerError ? err.code : 'UNKNOWN';
    throw new Error(
      `起動時接続性チェックに失敗しました（${code}: ${String(err)}）。` +
      `認証失敗なら API キー・シークレットを確認してください。起動を中止します。`,
    );
  }

  // 起動時 reconciliation（#186）: 補償キューは in-memory で再起動により揮発する。
  // 監視を始める前に DB とブローカーの OPEN 集合を突き合わせ、前回稼働中に生まれた
  // ゴーストポジション（broker 決済済み・DB は OPEN のまま）を掃除する。
  // 失敗時は fail-fast（直前の接続性チェックと同じ方針。不整合を抱えたまま監視を始めない）。
  const startupSync = await syncPositionsUseCase.execute();
  logger.info('起動時建玉同期完了', {
    event: 'startup_position_sync_ok',
    dbOpen: startupSync.dbOpen,
    brokerOpen: startupSync.brokerOpen,
    synced: startupSync.synced,
  });

  // 補償キューのリトライタイマー起動（#186）。セッションの生死とは独立に動く
  exitCompensationQueue.start();

  await tradingSession.start();
  logger.info('市場監視を開始しました');

  // 定期sync: ブローカー建玉とDBの整合性を1分ごとに確認
  setInterval(async () => {
    try {
      await syncPositionsUseCase.execute();
    } catch (err) {
      logger.error('定期sync失敗', { error: String(err) });
    }
  }, 60_000);
}

// --- シャットダウン ---
async function shutdown(signal: string) {
  logger.info('シャットダウン開始', { signal });
  try {
    // 市場監視を停止し、サーバー・DB 接続を閉じて終了するのみ。
    // OPEN ポジションは GMO 側に保持される。次回起動時に ExitDispatcher が
    // DB の OPEN を継承して監視・決済判定を再開するため、ここでの決済は不要。
    await tradingSession.stop();
    ratePort.stop();
    // 補償キューは最後まで粘る（in-flight の DB 補修を待ってから停止）。
    // 未収束分は起動時 reconciliation が引き継ぐ。
    await exitCompensationQueue.stop();

    await server.stop();
    await pool.end();
    logger.info('シャットダウン完了');
  } catch (err) {
    logger.error('シャットダウン中にエラー', { error: String(err) });
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  logger.error('起動失敗', { error: String(err) });
  process.exit(1);
});
