import type { EntryRule } from '../domain/rule/EntryRule.js';
import type { AllocationPolicy } from '../domain/allocation/AllocationPolicy.js';
import type { PositionSizingService } from './PositionSizingService.js';
import type { EntryQueuePort } from '../port/EntryQueuePort.js';
import type { PositionRepository } from '../port/PositionRepository.js';
import type { BalancePort } from '../port/BalancePort.js';
import type { UiNotifier } from '../port/UiNotifier.js';
import type { Clock } from '../port/Clock.js';
import type { EntryDecisionObserverPort } from '../port/EntryDecisionObserverPort.js';
import { NoopEntryDecisionObserver } from '../port/EntryDecisionObserverPort.js';
import type { EntryAdmissionPort } from '../domain/port/EntryAdmissionPort.js';
import { AlwaysPermitEntryAdmission } from '../domain/port/EntryAdmissionPort.js';
import type { LogPort } from '../domain/port/LogPort.js';
import type { CurrencyPair } from '../domain/market/CurrencyPair.js';
import type { MarketSnapshot } from '../domain/market/snapshot/MarketSnapshot.js';
import type { Balance } from '../domain/Balance.js';
import type { OpenPositions } from '../domain/position/OpenPositions.js';
import type { SizingResult } from '../domain/position/SizingResult.js';
import type { Lot } from '../domain/position/Lot.js';
import type { Position } from '../domain/position/Position.js';
import type { StrategyName, StrategyNameValue } from '../domain/rule/StrategyName.js';
import { EntryCommand } from '../domain/command/EntryCommand.js';
import { AllocationContext } from '../domain/allocation/AllocationContext.js';
import { DetectedSignals } from '../domain/rule/DetectedSignals.js';

/**
 * 複数戦略のエントリーを統合する司令塔（application 層）。
 *
 * 責務パイプライン: **Detect → Context → Allocate → Size → Cap → Enqueue**（policies.md 各節と対応）
 *
 * 1. **Detect**（policies.md 1.4.1）: 登録された `EntryRule[]` を評価し検知集合を組み立てる
 * 2. **Context**（policies.md 1.5 / 2.6）: `balancePort.freshNow` + `positionRepository.openPositions` で前提を取得し `AllocationContext` を作る
 * 3. **Allocate**（policies.md 1.4 / 1.4.1）: `AllocationPolicy.decide(context)` で `LotAllocation` を得る
 * 4. **Size**（policies.md 1.4 / 1.7）: `PositionSizingService.executeWithFresh(pair)` で `SizingResult`（lot / rate / requiredMargin）を取得（NH-2: rate 二重取得回避）
 * 5. **Cap**（policies.md 1.11）: 合計ロット上限超過時は **全件 drop + LogPort.warn**（部分絞り込みはしない確定方針）
 * 6. **Enqueue**（policies.md 2.6 / 2.7.3 / 3.5）: 戦略ごとに `EntryCommand` を組み立て `EntryQueue.enqueue`。同 pair × 同戦略の保有は in-memory（`OpenPositions.holdsStrategyOnPair`）で事前 skip
 *
 * UI 通知（policies.md 4.1）: `notifyEntryReady` 失敗時も enqueue は継続する fire-and-forget 相当。
 * 通知失敗は `LogPort.error` で記録するのみ（発注の必要条件ではない）。
 *
 * Note (Rule の EntryCommand の `lot` は基準値の参考であり、最終発注 lot は allocation 適用後に上書きされる):
 * EntryRule が返す `EntryCommand` は本来「シグナル素材 + 基準 Lot」を兼ねた中間表現。
 * PositionManager は `buySell` / `reason` / `convictionScore` / `entrySnapshot` のみ流用し、
 * `lot` は `StrategyLots`、`requiredMargin` は `SizingResult.requiredMarginFor(lot)` で再構築する。
 * 将来 `EntryCommand` を発注命令に純化し `EntrySignal` を分離する余地あり（別 issue）。
 *
 * 設計書: docs/design/position-manager/policies.md 1.4 / 1.4.1 / 1.11 / 2.6 / 2.7、brief.md 5.1〜5.4。
 *
 * Note: 本クラスは TradingSession から呼ばれることを想定するが、main.ts 配線と
 * TradingSession 置き換えは別 PR（phase7/wiring）で行う。本 PR では実装と単体テストのみ。
 */
export class PositionManager {
  /**
   * 直前の「全配分抑制」状態。GC/DC 圏でポジション保有中は毎 tick 抑制されるため、
   * 状態が変化した瞬間だけログを出す（同じ状態の連発を防ぐ）。
   */
  private wasFullySuppressed = false;

  /**
   * 直前の「番人による新規エントリー抑止」状態。抑止中は毎 tick 関門で止まるため、
   * 抑止に入った瞬間だけ理由をログに出す（同じ状態の連発を防ぐ）。
   */
  private wasEntryBlocked = false;

  constructor(
    private readonly entryRules: readonly EntryRule[],
    private readonly allocationPolicy: AllocationPolicy,
    private readonly sizingService: PositionSizingService,
    private readonly entryQueue: EntryQueuePort,
    private readonly positionRepository: PositionRepository,
    private readonly balancePort: BalancePort,
    private readonly uiNotifier: UiNotifier,
    private readonly clock: Clock,
    private readonly logger: LogPort,
    private readonly decisionObserver: EntryDecisionObserverPort = NoopEntryDecisionObserver,
    /** 新規エントリーの可否を問う関門（#290 Step2）。番人不在の構成では常に許可 */
    private readonly entryAdmission: EntryAdmissionPort = AlwaysPermitEntryAdmission,
  ) {}

  async handleSignals(pair: CurrencyPair, snapshot: MarketSnapshot): Promise<void> {
    // 0) 観測（繋ぎ）: GC/DC 検知と各フィルタの通過/却下を UI に流す。本番判定には干渉しない
    //    停止中でも観測は流す（運用画面で経過が見えるように）
    this.decisionObserver.observe(snapshot);

    // 0.5) 関門: 番人に新規エントリーの可否を問う（Detect より前。止めるなら何も始めない）
    //      抑止中なら enqueue まで到達せず新規発注は出ない。Exit 経路は番人を参照しない＝止まらない。
    const admission = this.entryAdmission.admitEntry();
    if (admission.isBlocked()) {
      // 抑止に入った瞬間だけ理由をログに出す（毎 tick の連発を防ぐ。wasFullySuppressed と同作法）
      if (!this.wasEntryBlocked) {
        this.logger.info('新規エントリーを番人が抑止中 - サイクル中断', {
          pair: pair.toString(),
          reason: admission.reasonLabel(),
        });
        this.wasEntryBlocked = true;
      }
      return;
    }
    this.wasEntryBlocked = false;

    // 1) Detect: EntryRule 群を評価して検知集合を組み立て
    const detection = this.detect(snapshot);
    if (detection === null) return;

    // 2) Context: balance / openPositions を取得して AllocationContext を組み立て
    const context = await this.buildContext(pair, detection.signals);
    if (context === null) return;

    // 3) Allocate: AllocationPolicy.decide
    const allocation = this.allocationPolicy.decide(context);
    if (allocation.isFullySuppressed()) {
      // GC/DC 圏でポジション保有中は毎 tick ここに来るため、抑制状態に入った
      // 瞬間だけログを出す（同じ状態の連発を防ぐ）。
      if (!this.wasFullySuppressed) {
        this.logger.info('allocation fully suppressed - 配分なし', {
          pair: pair.toString(),
          strategies: detection.signals.strategies(),
        });
        this.wasFullySuppressed = true;
      }
      return;
    }
    this.wasFullySuppressed = false;

    // 4) Size: 発注直前の鮮度保証で SizingResult を取得
    const sizing = await this.fetchSizing(pair);
    if (sizing === null) return;

    // 5) Cap: 合計ロット上限超過時は全件 drop（policies.md 1.11）
    const strategyLots = allocation.apply(sizing.lot());
    if (strategyLots.totalLot().isExceedingSingleLotLimit()) {
      this.logger.warn('strategyLots 合計が単一 Lot 上限を超過 - 全件 drop', {
        pair: pair.toString(),
        total: strategyLots.totalLot().toString(),
        strategies: strategyLots.strategies(),
      });
      return;
    }

    // 6) Enqueue: 戦略ごとに EntryCommand を組み立てて投入
    for (const strategy of strategyLots.strategies()) {
      const lot = strategyLots.lotOf(strategy);
      if (lot === null) continue;
      const base = detection.baseCommands.get(strategy);
      if (!base) continue; // detection 段で揃えているはずだが防御
      await this.enqueueFor(pair, strategy, lot, base, sizing, context.currentPositions());
    }
  }

  /** Detect 段: EntryRule 群の評価結果を DetectedSignals + 部品取り用 baseCommands に束ねる */
  private detect(
    snapshot: MarketSnapshot,
  ): { signals: DetectedSignals; baseCommands: Map<StrategyNameValue, EntryCommand> } | null {
    const detected: StrategyName[] = [];
    const baseCommands = new Map<StrategyNameValue, EntryCommand>();
    for (const rule of this.entryRules) {
      const result = rule.shouldEntry(snapshot);
      if (result instanceof EntryCommand) {
        detected.push(result.strategyName);
        baseCommands.set(result.strategyName, result);
      }
      // 型上 EntryCommand 以外は DoNothing.instance なのでスキップ
    }
    if (detected.length === 0) return null;
    return { signals: DetectedSignals.of(detected), baseCommands };
  }

  /**
   * Context 段: balance / openPositions を取得して AllocationContext を組み立て。
   *
   * ドメイン暗黙条件（X2 / X3）:
   * `openPositions` は **TradingSession.onMarketData が `evaluateExit → evaluateEntry` の順で
   * 呼ぶことで「直前 Exit の決済確定が DB に反映された後」の状態**を取得する。これにより
   * ドテン（同 tick で決済 → 反対方向エントリー）が成立する（policies.md 1.4.1 / 2.7.1）。
   * TradingSession.evaluateExit と本メソッドで positionRepository.openPositions を独立に
   * 2 回呼ぶのは、この「Exit 反映後」セマンティクスを担保するため。I/O 重複は
   * tick あたり 2 DB ラウンドトリップで許容（policies.md 2.7.1 ドテン仕様）。
   */
  private async buildContext(
    pair: CurrencyPair,
    signals: DetectedSignals,
  ): Promise<AllocationContext | null> {
    let balance: Balance;
    try {
      balance = await this.balancePort.freshNow();
    } catch (err) {
      this.logger.warn('balancePort.freshNow 失敗 - エントリーサイクル中断', {
        pair: pair.toString(),
        error: String(err),
      });
      return null;
    }
    let openPositions: OpenPositions;
    try {
      openPositions = await this.positionRepository.openPositions();
    } catch (err) {
      this.logger.warn('positionRepository.openPositions 失敗 - エントリーサイクル中断', {
        pair: pair.toString(),
        error: String(err),
      });
      return null;
    }
    return AllocationContext.of(pair, signals, openPositions, balance);
  }

  /** Size 段: 発注直前の鮮度保証で SizingResult を取得 */
  private async fetchSizing(pair: CurrencyPair): Promise<SizingResult | null> {
    try {
      return await this.sizingService.executeWithFresh(pair);
    } catch (err) {
      this.logger.warn('sizingService.executeWithFresh 失敗 - エントリーサイクル中断', {
        pair: pair.toString(),
        error: String(err),
      });
      return null;
    }
  }

  /**
   * Enqueue 段: 1 戦略分の EntryCommand を組み立てて投入する。
   *
   * 重複ポジション抑制の二段防御（policies.md 2.6 / 2.7.3）:
   * - **一次防御 (in-memory)**: Context 段で取得した `openPositions.holdsStrategyOnPair` で即座に判定。
   *   AllocationContext と同じスナップショットで一貫判定する。
   * - **二次防御 (DB 直前確認)**: enqueue 直前に `positionRepository.findOpenByPairAndStrategy` を呼び、
   *   snapshot 後に他経路（ドテン後の決済確定遅延・将来の並列ワーカー・管理ツール手動介入）が
   *   ポジションを開いた状態を捕捉する。DB 障害時は warn して当該戦略のみ skip（fail-safe）。
   *
   * - `requiredMargin` は `SizingResult.requiredMarginFor(lot)` で再算出（NH-2: rate / marginRate を SizingResult に閉じ込め、application 層に MarginRate を持たせない）
   * - `notifyEntryReady` 失敗時も enqueue 継続（policies.md 4.1: UI 通知は発注の必要条件ではない fire-and-forget 相当）
   */
  private async enqueueFor(
    pair: CurrencyPair,
    strategy: StrategyName,
    lot: Lot,
    base: EntryCommand,
    sizing: SizingResult,
    openPositions: OpenPositions,
  ): Promise<void> {
    // 一次防御: in-memory snapshot
    if (openPositions.holdsStrategyOnPair(pair, strategy)) {
      this.logger.info('duplicate entry suppressed (in-memory)', {
        pair: pair.toString(),
        strategy: strategy,
        attemptedLot: lot.toString(),
      });
      return;
    }

    // 二次防御: DB 直前確認（snapshot 後のレース・ドテン遅延対策）
    let existing: Position | null;
    try {
      existing = await this.positionRepository.findOpenByPairAndStrategy(pair, strategy);
    } catch (err) {
      this.logger.warn('findOpenByPairAndStrategy 失敗 - 当該戦略を skip (fail-safe)', {
        pair: pair.toString(),
        strategy: strategy,
        error: String(err),
      });
      return;
    }
    if (existing !== null) {
      this.logger.info('duplicate entry suppressed (db pre-check)', {
        pair: pair.toString(),
        strategy: strategy,
        attemptedLot: lot.toString(),
      });
      return;
    }

    const requiredMargin = sizing.requiredMarginFor(lot);
    const command = EntryCommand.of({
      pair,
      buySell: base.buySell,
      lot,
      reason: base.reason,
      convictionScore: base.convictionScore,
      strategyName: strategy,
      entrySnapshot: base.entrySnapshot,
      requiredMargin,
    });

    // fire-and-forget: enqueue を notify の I/O でブロックしない（policies.md 4.1）
    void this.uiNotifier.notifyEntryReady(command).catch((err) => {
      this.logger.error('notifyEntryReady 失敗 (発注は継続 / policies.md 4.1)', {
        pair: pair.toString(),
        strategy: strategy,
        error: String(err),
      });
    });
    this.entryQueue.enqueue(command, this.clock.now());
  }

}
