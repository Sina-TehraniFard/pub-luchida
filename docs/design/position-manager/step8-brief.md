# Step 8 ブリーフ v3.1 — ExitRule 戦略別ディスパッチ + ExitDispatcher 抽出

Issue: #51 Step 8
親 Issue 進捗表参照: <https://github.com/Sina-TehraniFard/luchida/issues/51>
関連設計書: `policies.md` 2.5 / 2.6 / 2.7.1 / 4.1、`brief.md` 5.4、`value-objects.md`
派生 Issue: #186（補償リトライ）/ #187（起動時 DB throw リトライ）/ #188（`exitLabelOf` displayName 化）

**v3.1 改訂点**: v3 軽量再レビュー指摘 D1-D3 / C1-C4 を反映。

---

## 1. 目的

`TradingSession` の ExitRule 評価を **戦略別 lookup** に切り替え、`(pair, strategy_name)` 独立決済を成立させる。同時に `ExitDispatcher`（application 層）を抽出し、`TradingSession` を **lifecycle + routing 専属** に縮退させる。

Step 7 で Entry 経路（`PositionManager` 委譲化）は完了。Step 8 で Exit 経路を対称形に整え、Issue #51 のコア要件「戦略ごとのポジション独立管理」を完成させる。

---

## 2. スコープ

### Domain 層（純粋追加）

- **`OpenPositions` 拡張**:
  - `sortedByOpenedAtAsc(): OpenPositions` — 自己同型。`openedAt` 昇順、二次キー `PositionId.compareTo`
  - `forPair(pair: CurrencyPair): OpenPositions` — pair 射影（自己同型、既存 `xxxFor(pair)` 慣習）
  - `heldStrategyNames(): ReadonlySet<StrategyNameValue>` — 全 pair の保有戦略集合
- **`PositionId.compareTo(other: PositionId): number`** — 二次キー比較ロジックを VO に閉じる
- **`ExitRuleRegistry`**（`domain/rule/ExitRuleRegistry.ts`）— ファーストクラスコレクション
  - `of(entries: ReadonlyArray<readonly [StrategyName, ExitRule]>): ExitRuleRegistry` — **タプル配列入力**（#130 未完で StrategyName が参照同値しか持たないため、Map 入力では重複検知が機能しない / D3 反映）
  - `ruleFor(strategy: StrategyName): ExitRule` — 未登録は `MissingExitRuleError` を throw（**throw 契約は JSDoc 明記**、`RatePort.currentFresh` 流に既存パターン整合 / C2 反映）
  - `has(strategy: StrategyName): boolean`
  - `registeredStrategies(): ReadonlySet<StrategyNameValue>`
- **`MissingExitRuleError`**（`domain/error/MissingExitRuleError.ts`）— `notRegistered(strategy: StrategyName)` static factory（`DuplicatePositionError.detectedByDomain` 等の動詞句 factory 慣習に整合）
- **`ExitDispatchResult`**（`domain/exit/ExitDispatchResult.ts`）— `dispatch` の戻り値 VO
  - `closed: PositionId[]`
  - `skipped: Array<{ positionId: PositionId; strategy: StrategyName; reason: 'rule_missing' | 'extremes_unavailable' }>`
  - `failed: Array<{ positionId: PositionId; strategy: StrategyName; errorName: string }>`（**`errorName` を採用**、`Error.prototype.name` 整合 / C4 反映。`strategy` は VO のまま保持しプリミティブ降格しない）

### Port 層

- **`PositionExtremesPort`** interface（Reader、`packages/backend/src/port/PositionExtremesPort.ts`）— **既存 `xxxPort` 慣習に統一 / C1 反映**
  - `find(positionId: PositionId): ExtremesSnapshot | undefined`
  - `remove(positionId: PositionId): void` — closed 後のクリーンアップは Port の責務（D2 反映）
- **`PositionExtremesWriter`** interface（Writer、`packages/backend/src/port/PositionExtremesWriter.ts`）— ISP/CQS で Reader と分離（PR C レビュー反映で追加）
  - `update(pair, snapshot): Promise<void>`

### Application 層

- **`PositionExtremesUpdater`**（`application/PositionExtremesUpdater.ts`、`PositionExtremesPort`（Reader）+ `PositionExtremesWriter`（Writer）の両方を実装）
  - `update(pair, snapshot): Promise<void>`
  - `find(positionId): ExtremesSnapshot | undefined`
  - `remove(positionId): void`
- **`ExitDispatcher`**（`application/ExitDispatcher.ts`、**stateless**）
  - `dispatch(pair: CurrencyPair, snapshot: MarketSnapshot): Promise<ExitDispatchResult>`
  - 依存（6 つ）: `ExitRuleRegistry` / `PositionRepository` / `ExitExecution` / `UiNotifier` / `PositionExtremesPort` / `LogPort`
  - **`closed` の `extremesPort.remove` は ExitDispatcher 内で呼ぶ**（D2 反映: 責務一貫）

### TradingSession 縮退

- `evaluateExit` 削除。`onMarketData` 内で `extremesUpdater.update → exitDispatcher.dispatch → positionManager.handleSignals` の順
- 排他フラグ `exitInProgress` を **`processing` に名前変更して残置**（N1）
- 依存数: 9 → 8

### main.ts DI 配線

- `ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaExitRule], ...])` を構築（**タプル配列入力 / D3**）
- **起動時 fail-fast 検証**: `await positionRepository.openPositions()` の保有戦略が `registry.registeredStrategies()` の subset か検証。違反は日本語メッセージで throw（PM2 起動失敗）
- `PositionExtremesUpdater`（= `PositionExtremesPort` 実装）/ `ExitDispatcher` を組み立てて `TradingSession` に注入
- 起動ログに `registry.registeredStrategies()` のソート済み配列を `event: 'exit_rule_registry_loaded'` で出力

### 設計書

- 新規 `docs/design/sequence/core/multi-strategy-exit.md`（PR B で作成、ExitDispatcher 名込み）
- 更新 `policies.md` 2.5（PR B）
- 更新 `value-objects.md`（PR B）

### テスト

- `OpenPositions.test`: 自己同型 sort / `forPair` / `heldStrategyNames`
- `PositionId.test`: `compareTo` 全順序性
- `ExitRuleRegistry.test`: 重複拒否（`.value` レベル）/ `ruleFor` throw / 集合 API
- `MissingExitRuleError.test`: `notRegistered` factory
- `ExitDispatchResult.test`: 構造的等価性
- `ExitDispatcher.test`: pair-bound / 戦略別 lookup / `MissingExitRuleError` 捕捉 / 評価順 / 例外境界 / `closed` 後の `remove` 呼び出し検証
- `PositionExtremesUpdater.test`: lazy 追跡 / `forPair` 適用 / `remove`
- `TradingSession.test`: 委譲後の lifecycle / pair-bound / stopped / `processing` 排他 / tick drop 挙動

---

## 3. 受け入れ基準

1. `TradingSession.evaluateExit` メソッドが存在しない（grep 0 件）
2. 戦略 A の Position は 戦略 A の ExitRule のみが評価される
3. 評価順は `openedAt` 昇順、同 `openedAt` は `PositionId.compareTo` 順
4. 1 戦略の `ExitRule.shouldExit` throw は他戦略評価を止めない
5. 起動時に `ExitRuleRegistry` と `openPositions` の戦略集合不整合があれば `main.ts` が throw して PM2 起動失敗
6. **責務記述**: `TradingSession` は lifecycle と routing のみを持ち、`ExitRule` / `ExitExecution` / `ExtremeTracker` / `PositionRepository` / `UiNotifier` を直接保持しない
7. `ExitDispatcher` は pair-bound（`dispatch(pair, snapshot)` 引数）
8. `TradingSession.processing` 排他で再入時の二重決済が発生しない（テストで再入シミュレーション含む）
9. `ExitDispatchResult.failed.length > 0` のとき `LogPort.error` で `event: 'exit_dispatch_failed'` 構造化ログ
10. 派生 Issue #186 / #187 / #188 起票済み
11. **`ExitDispatcher` 内で `closed` Position の `extremesPort.remove` を呼ぶ**（責務一貫 / D2）
12. backend `npm test` / `npm run typecheck` PASS

---

## 4. 既存の土台（v0.6.6 時点）

| 項目 | 状態 |
|---|---|
| `StrategyNameValue` 型 | ✅ |
| `OpenPositions.heldStrategyNamesFor(pair)` | ✅ |
| `PositionRepository.findOpenByPairAndStrategy` | ✅ |
| `PositionManager`（Entry 側、pair-bound） | ✅ Step 7 |
| `OpenPositions.sortedByOpenedAtAsc` / `forPair` / `heldStrategyNames` | ❌ PR A |
| `PositionId.compareTo` | ❌ PR A |
| `ExitRuleRegistry` / `MissingExitRuleError` | ❌ PR A |
| `ExitDispatchResult` | ❌ PR A |
| `PositionExtremesPort` / `PositionExtremesUpdater` | ❌ PR B |
| `ExitDispatcher` | ❌ PR B |
| `multi-strategy-exit.md` | ❌ PR B |

---

## 5. 新設計

### 5.1 `ExitRuleRegistry`（タプル配列入力 + ruleFor throw 型）

```ts
// domain/rule/ExitRuleRegistry.ts
export class ExitRuleRegistry {
  private constructor(private readonly byStrategy: ReadonlyMap<StrategyNameValue, ExitRule>) {}

  /**
   * 戦略と ExitRule のペアからレジストリを構築する。
   * 入力はタプル配列（Map ではない）。
   * 理由: #130 未完で StrategyName は class かつ of() が毎回 new するため、
   * Map<StrategyName, ExitRule> では JS の参照同値で重複検知が機能しない。
   * タプル配列で受けて内部で .value 文字列同値で重複チェックする（D3 反映）。
   */
  static of(entries: ReadonlyArray<readonly [StrategyName, ExitRule]>): ExitRuleRegistry {
    const map = new Map<StrategyNameValue, ExitRule>();
    for (const [name, rule] of entries) {
      if (map.has(name.value)) {
        throw new Error(`ExitRuleRegistry: 重複登録 "${name.value}"`);
      }
      map.set(name.value, rule);
    }
    return new ExitRuleRegistry(map);
  }

  /**
   * 戦略に対応する ExitRule を返す。
   * @throws MissingExitRuleError 未登録の戦略を指定した場合
   *
   * 起動時 fail-fast で「未登録は本来あり得ない」状態にしているため、
   * 運用中に throw が出るのは「Rule 撤去後の OPEN ポジション」のような不整合シナリオのみ。
   * 既存パターン: RatePort.currentFresh と同様、動詞そのもの + JSDoc で throw 契約を明示（C2）。
   */
  ruleFor(strategy: StrategyName): ExitRule {
    const rule = this.byStrategy.get(strategy.value);
    if (!rule) throw MissingExitRuleError.notRegistered(strategy);
    return rule;
  }

  has(strategy: StrategyName): boolean { /* */ }
  registeredStrategies(): ReadonlySet<StrategyNameValue> { /* */ }
}
```

### 5.2 `ExitDispatcher`（stateless / Port 注入 / closed remove 内包）

```ts
// application/ExitDispatcher.ts
/**
 * 責務パイプライン: Load → Filter (pair) → Sort → Evaluate per position → Close → Notify → Remove(closed)。
 *
 * MFE/MAE の取得・clean up は PositionExtremesPort 経由（更新責務は PositionExtremesUpdater）。
 * 排他制御は責務外（TradingSession.processing が担う）。
 *
 * Note (pair-bound 不変条件):
 *   dispatch(pair, snapshot) は引数 pair に紐づく Position のみ評価する。
 *
 * Note (例外境界 / policies.md 2.5):
 *   - registry.ruleFor (MissingExitRuleError) → LogPort.warn + skipped 記録 + continue
 *   - rule.shouldExit throw → LogPort.error + failed 記録 + continue
 *   - exitExecution.closePosition throw → LogPort.error + 通知 skip + failed 記録（次 tick 再評価 / #186）
 *   - uiNotifier.notifyExitExecuted throw → LogPort.error + closed に積む（決済確定済み）
 *
 * 設計書: docs/design/position-manager/policies.md 2.5。
 */
export class ExitDispatcher {
  constructor(
    private readonly registry: ExitRuleRegistry,
    private readonly positionRepository: PositionRepository,
    private readonly exitExecution: ExitExecution,
    private readonly uiNotifier: UiNotifier,
    private readonly extremesPort: PositionExtremesPort,
    private readonly logger: LogPort,
  ) {}

  async dispatch(pair: CurrencyPair, snapshot: MarketSnapshot): Promise<ExitDispatchResult> {
    const ordered = (await this.positionRepository.openPositions())
      .forPair(pair)
      .sortedByOpenedAtAsc();

    const closed: PositionId[] = [];
    const skipped: Array<{ positionId: PositionId; strategy: StrategyName; reason: 'rule_missing' | 'extremes_unavailable' }> = [];
    const failed: Array<{ positionId: PositionId; strategy: StrategyName; errorName: string }> = [];

    for (const position of ordered) {
      let rule: ExitRule;
      try {
        rule = this.registry.ruleFor(position.strategyName);
      } catch (err) {
        // MissingExitRuleError 以外（想定外の障害）は隠蔽せず再 throw する。
        // 広すぎる catch で実装バグや TypeError 等を warn + skipped に流すと、
        // 本来止めるべき障害が運用ログ埋もれする。
        if (!(err instanceof MissingExitRuleError)) throw err;
        this.logger.warn('ExitRule 未登録 - 戦略 skip', {
          event: 'exit_rule_missing',
          strategy: position.strategyName.value,
          positionId: position.id.toString(),
        });
        skipped.push({
          positionId: position.id,
          strategy: position.strategyName,
          reason: 'rule_missing',
        });
        continue;
      }
      try {
        const result = rule.shouldExit(snapshot, position);
        if (result instanceof ExitCommand) {
          const extremes = this.extremesPort.find(position.id);
          if (!extremes) {
            this.logger.warn('ExitCommand 発火したが極値未追跡 - 次 tick 再評価', {
              event: 'exit_extremes_unavailable',
              strategy: position.strategyName.value,
              positionId: position.id.toString(),
            });
            skipped.push({
              positionId: position.id,
              strategy: position.strategyName,
              reason: 'extremes_unavailable',
            });
            continue;
          }
          await this.closeAndNotify(result, position, extremes);
          closed.push(position.id);
          this.extremesPort.remove(position.id);  // D2 反映: ExitDispatcher が責任を持って clean up
        }
      } catch (err) {
        this.logger.error('ExitRule 評価失敗 - 当該戦略を skip', {
          strategy: position.strategyName.value,
          positionId: position.id.toString(),
          error: String(err),
        });
        failed.push({
          positionId: position.id,
          strategy: position.strategyName,
          errorName: err instanceof Error ? err.name : 'Unknown',  // C4 反映
        });
      }
    }
    return ExitDispatchResult.of({ closed, skipped, failed });
  }

  private async closeAndNotify(cmd: ExitCommand, position: Position, extremes: ExtremesSnapshot): Promise<void> {
    try {
      await this.exitExecution.closePosition(cmd, extremes);
    } catch (err) {
      this.logger.error('決済実行失敗 - 次 tick で再評価', {
        positionId: position.id.toString(),
        strategy: position.strategyName.value,
        error: String(err),
      });
      throw err;  // dispatch 内 catch で failed に積まれる
    }
    try {
      await this.uiNotifier.notifyExitExecuted(cmd);
    } catch (err) {
      this.logger.error('決済通知失敗', { positionId: position.id.toString(), error: String(err) });
      // 決済確定済みなので throw しない（closed に積まれる）
    }
  }
}
```

### 5.3 `PositionExtremesPort` / `PositionExtremesWriter` / `PositionExtremesUpdater`（Reader/Writer 分離 + 統一実装）

**Note (PR C レビュー反映 / 2026-05-19)**: `update` 責務を別 interface `PositionExtremesWriter` に分離（ISP/CQS）。`ExitDispatcher` は Reader（`find`/`remove`）のみに依存、`TradingSession` は Writer（`update`）のみに依存し、`PositionExtremesUpdater` が両方を実装する。これにより「ExitDispatcher が誤って update を呼ぶ事故」を型レベルで防げる。

以下の `PositionExtremesPort` サンプルでは便宜上 `get` を旧 API として残しているが、**実装は `find: ExtremesSnapshot | undefined`（Optional 返却）に確定**（R1 反映）。


```ts
// packages/backend/src/port/PositionExtremesPort.ts（Reader: 既存 Port 配置慣習 / C1）
export interface PositionExtremesPort {
  find(positionId: PositionId): ExtremesSnapshot | undefined;
  remove(positionId: PositionId): void;
}

// packages/backend/src/port/PositionExtremesWriter.ts（Writer: PR C で分離）
export interface PositionExtremesWriter {
  update(pair: CurrencyPair, snapshot: MarketSnapshot): Promise<void>;
}

// packages/backend/src/application/PositionExtremesUpdater.ts
export class PositionExtremesUpdater implements PositionExtremesPort, PositionExtremesWriter {
  constructor(
    private readonly positionRepository: PositionRepository,
    private readonly tracker: ExtremeTracker = new ExtremeTracker(),
  ) {}

  async update(pair: CurrencyPair, snapshot: MarketSnapshot): Promise<void> {
    const forPair = (await this.positionRepository.openPositions()).forPair(pair);
    for (const position of forPair) {
      this.tracker.update(position.id.toString(), snapshot.tick.bid(), snapshot.tick.ask(), position.buySell);
    }
  }

  find(positionId: PositionId): ExtremesSnapshot | undefined {
    return this.tracker.get(positionId.toString());
  }

  remove(positionId: PositionId): void {
    this.tracker.remove(positionId.toString());
  }
}
```

### 5.4 `TradingSession` 縮退後（processing 排他 / tick drop 明記）

```ts
export class TradingSession {
  private readonly logger = new Logger('TradingSession');
  private stopped = false;
  /**
   * onMarketData の再入排他フラグ（旧 exitInProgress を改名 / N1）。
   * MarketDataStream.subscribe の listener 呼び出しが await されないため、
   * tick 密集時に Promise 完了前の再入が起こり得る。EntryQueue.draining と同パターン。
   * 真の解決は MarketDataStream 側の await 化（別 Issue）で、Step 8 では暫定防衛。
   *
   * Note (tick drop / D1):
   *   再入時の tick は丸ごと drop される。これは
   *   - Entry/Exit シグナル判定は最新 tick の MarketSnapshot で十分（過去 tick の参照は SMA 累積側で吸収）
   *   - MFE/MAE は drop された tick の極値を取りこぼす低頻度シナリオ（許容範囲）
   *   という前提で許容する。
   */
  private processing = false;

  constructor(
    private readonly pair: CurrencyPair,
    private readonly positionManager: PositionManager,
    private readonly exitDispatcher: ExitDispatcher,
    private readonly extremesWriter: PositionExtremesWriter,  // ISP: TradingSession は Writer のみに依存
    private readonly entryQueue: EntryQueuePort,
    private readonly timeFrameBook: TimeFrameBook,
    private readonly marketDataStream: MarketDataStreamPort,
    private readonly candleHistoryPort: CandleHistoryPort,
  ) {}

  // start / stop は現状維持

  async onMarketData(snapshot: MarketSnapshot): Promise<void> {
    if (this.stopped) return;
    if (!currencyPairEquals(snapshot.pair, this.pair)) {
      this.logger.warn('snapshot.pair が session の pair と不一致 - 無視', { /* */ });
      return;
    }
    if (this.processing) return;  // 再入抑止（N1 / tick drop は 5.4 Note 参照）
    // Note: tick drop の観測のため、PR C 実装時に `logger.debug('tick dropped due to re-entry', { pair })` を
    // 早期 return の直前に出すか検討する。drop 頻度が想定外に高いと判明したら、
    // MarketDataStream.subscribe の listener await 化（別 Issue）の優先度を上げる根拠になる。
    this.processing = true;
    try {
      // 順序: 1) MFE/MAE 更新 → 2) Exit 評価 → 3) Entry 評価（ドテン契約 / policies.md 2.7.1）
      await this.extremesWriter.update(this.pair, snapshot);
      const result = await this.exitDispatcher.dispatch(this.pair, snapshot);
      if (result.failed.length > 0) {
        this.logger.error('ExitDispatch 失敗あり', {
          event: 'exit_dispatch_failed',
          failedCount: result.failed.length,
          failed: result.failed.map(f => ({
            positionId: f.positionId.toString(),
            strategy: f.strategy,
            errorName: f.errorName,
          })),
        });
      }
      // closed の extremes remove は ExitDispatcher 内で完結する（D2: 責務一貫）
      await this.positionManager.handleSignals(this.pair, snapshot);
    } finally {
      this.processing = false;
    }
  }
}
```

### 5.5 評価順の決定論化（H12）

- 一次キー: `position.openedAt` 昇順
- 二次キー: `PositionId.compareTo(other)`
- `OpenPositions.sortedByOpenedAtAsc()` 戻り値は `OpenPositions` 自己同型

### 5.6 起動時 fail-fast 検証

```ts
// main.ts（日本語メッセージ）
const registry = ExitRuleRegistry.of([[StrategyName.SMA_CROSS, smaExitRule]]);
const openAtStartup = await positionRepository.openPositions();
const held = openAtStartup.heldStrategyNames();
const registered = registry.registeredStrategies();

const orphaned = [...held].filter(s => !registered.has(s));
if (orphaned.length > 0) {
  throw new Error(
    `ExitRuleRegistry に未登録の戦略を保有中: ${JSON.stringify(orphaned)}. ` +
    `起動を中止します（保有戦略には対応する ExitRule の登録が必要）。` +
    `対処手順: docs/runbook/exit-rule-orphan.md`  // PR C 実装時に該当 runbook を整備する
  );
}
logger.info('ExitRuleRegistry 配線完了', {
  event: 'exit_rule_registry_loaded',
  strategies: [...registered].sort(),
});
```

起動時の DB throw リトライは **#187 で対応**。本 Step では throw → 起動失敗（既存挙動と同等）。

### 5.7 例外境界

| 層 | throw 時の挙動 | 観測 |
|---|---|---|
| `registry.ruleFor` (`MissingExitRuleError`) | `warn` + `skipped` 記録 + continue | `event: 'exit_rule_missing'` |
| `rule.shouldExit` | `error` + `failed` 記録 + continue | `event: 'exit_dispatch_failed'` |
| `exitExecution.closePosition` | `error` + 通知 skip + `failed` 記録（部分成功は **#186** 補償） | `event: 'exit_dispatch_failed'` |
| `uiNotifier.notifyExitExecuted` | `error` + `closed` に積む（決済確定済み）| 個別ログ |

### 5.8 SL/TP 公平性について

評価順 `openedAt` 昇順は「**公平性のため**」ではなく「**決定論性のため**」採用。同 tick 多重 SL/TP 到達時の broker rate limit 由来スリッページは allow（将来別 Issue）。

---

## 6. PR 分割案

| PR | スコープ | 依存 |
|---|---|---|
| **A** | 純 domain 追加: `OpenPositions.sortedByOpenedAtAsc` / `forPair` / `heldStrategyNames` + `PositionId.compareTo` + `ExitRuleRegistry` + `MissingExitRuleError` + `ExitDispatchResult` + 各テスト | なし |
| **B** | `PositionExtremesPort` + `PositionExtremesUpdater` + `ExitDispatcher` + テスト + `multi-strategy-exit.md` + `policies.md 2.5` 同期 + `value-objects.md` 同期 | A |
| **C** | `TradingSession` 委譲化（`processing` 排他）+ `main.ts` DI 配線 + 起動時 fail-fast + テスト追従 + ローカル動作確認 | B |

---

## 7. 未解決の論点（v3.1 で残るもの）

すべて派生 Issue または将来余地として整理済み。Step 8 内に未解決論点なし。

| ID | 論点 | v3.1 確定 |
|---|---|---|
| Q1-Q11 | （v3 で確定） | 変更なし |
| Q12 | 起動時 fail-fast を application service に切り出すか | 本 Step は main.ts 直書き。将来余地（DDD R3） |
| Q13 | 起動時 DB throw リトライ | #187 |
| Q14 | MarketDataStream listener await 化 | Step 8 マージ後に Issue 起票判断 |

---

## 8. テスト観点（v3 と同等。`extremesPort.remove` 呼び出し検証を 8.4 に追加）

### 8.1 `OpenPositions` 拡張

- `sortedByOpenedAtAsc`: 昇順 / 二次キー / 自己同型 / 不変
- `forPair`: 射影 / 空 / 不変
- `heldStrategyNames`: 全 pair 集合 / 重複除去

### 8.2 `PositionId.compareTo`

- 全順序性 / 同値で 0 / 決定論

### 8.3 `ExitRuleRegistry` / `MissingExitRuleError`

- 重複登録 throw（`.value` 同値で検知）
- `ruleFor(未登録)` で `MissingExitRuleError` throw
- `MissingExitRuleError.notRegistered(strategy)` factory

### 8.4 `ExitDispatcher.dispatch`

- pair-bound / 戦略別 lookup / `MissingExitRuleError` 捕捉 → `warn + skipped`
- `rule.shouldExit` throw → `error + failed`（`errorName` が正しく入る）
- `exitExecution.closePosition` throw → 通知 skip + `failed`
- `uiNotifier.notifyExitExecuted` throw → `closed` に積む
- 評価順
- **`closed` Position に対して `extremesPort.remove` が呼ばれる**（D2 検証）
- `ExitDispatchResult` の集計

### 8.5 `PositionExtremesUpdater`

- lazy 追跡 / pair-bound / `remove`

### 8.6 `TradingSession`

- 委譲後の `onMarketData` の順序
- pair-bound / stopped ガード
- **`processing` 排他 + tick drop 挙動**（再入時に即 return、その tick は drop されることをテストで明示 / D1）
- `failed` 時の `event: 'exit_dispatch_failed'` ログ

### 8.7 main.ts 起動時 fail-fast

- 一致で起動成功 / 不整合で日本語 throw

---

## 9. リスク / 留意点

- **#130 未完**: `ExitRuleRegistry.of` はタプル配列入力（Map では参照同値で重複検知できない）。#130 完了後は Map 入力へ書き換え可
- **部分成功シナリオ（#186 完了まで）**: GMO 残高との手動 reconciliation を朝晩 runbook 化で防衛
- **起動時 DB throw リトライ（#187 完了まで）**: PM2 `max_restarts` 設定で防衛
- **MarketDataStream listener await 化**: 別 Issue（Step 8 スコープ外）。`processing` フラグで暫定防衛
- **tick drop の MFE/MAE 取りこぼし**: 低頻度シナリオで allow（5.4 Note）
- **SL/TP 公平性**: 同 tick 多重 SL のスリッページ allow（5.8）
- **Rule 撤去 runbook**: 「該当戦略の OPEN を全件決済 → Rule 撤去 → 再起動」を runbook 化

---

## 10. ブランチ命名

- 親: `phase8/main`
- 作業: `phase8/exit-foundation`（PR A）/ `phase8/exit-dispatcher`（PR B）/ `phase8/exit-wiring`（PR C）

---

## 11. 派生 Issue

| Issue | 内容 | 起票 |
|---|---|---|
| **#186** | refactor: ExitExecution 補償リトライキュー + N連続失敗 kill-switch | ✅ |
| **#187** | refactor: 起動時 DB throw リトライ + 健康度チェック | ✅ |
| **#188** | refactor: exitLabelOf を ExitType.displayName に移管（A5）| ✅ |
| 未起票 | refactor: MarketDataStream.subscribe の listener を await 化（N1 根本対策） | Step 8 マージ後判断 |
| 未起票 | refactor: 起動時 fail-fast を application service に切り出す | Step 8 マージ後判断 |

---

## 12. v3 → v3.1 変更点まとめ

| 領域 | v3 | v3.1 |
|---|---|---|
| Registry 入力 | `Map<StrategyName, ExitRule>` | **タプル配列**（D3: 参照同値問題回避） |
| Registry lookup | `mustRuleFor` | **`ruleFor` + JSDoc throw 明記**（C2: 既存パターン整合） |
| Error factory | `new MissingExitRuleError(s)` | **`MissingExitRuleError.notRegistered(s)`**（domain/error 動詞句 factory 慣習に整合 / PR #189 レビュー反映） |
| Result `errorClass` | `string` | **`errorName: string`**（C4: `Error.prototype.name` 整合） |
| Port 命名 | `PositionExtremesReader` interface | **`PositionExtremesPort`**（C1: 既存 Port 接尾辞慣習 + `packages/backend/src/port/` 配置） |
| Port メソッド | `get` のみ | **`find` + `remove`**（R1/D2: Optional 返却 + closed clean up を Port 契約に含める） |
| `closed` の remove | `TradingSession` が consume | **`ExitDispatcher` 内で完結**（D2: 責務一貫） |
| tick drop | 未言及 | **5.4 Note で明記**（D1: Entry/Exit 最新 tick 前提 / MFE/MAE 低頻度許容） |
