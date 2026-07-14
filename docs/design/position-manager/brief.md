# PositionManager 設計ブリーフ

Issue: #51 ポジションマネージャー + 動的ロット
Branch: `position-manager/main`
作成日: 2026-04-22

---

## 1. 目的

複数戦略（SMA クロスを起点に N 戦略へ拡張可能。RSI 逆張り / SMA 乖離逆張り / ヒゲ逆張り 等の追加を見越す）が同時稼働する世界で、エントリーシグナルの統合・戦略ごとのポジション独立管理・残高ベースの動的ロット計算・発注の順序制御を担う層を設ける。現状の「単一 Rule・CAPITAL 固定・1ポジション制約」前提からの脱却。

**PositionManager の責務パイプライン（R3）**:

`PositionManager` は `TradingSession.evaluateEntry` から呼ばれる司令塔であり、**Detect → Allocate → Size → Enqueue** のパイプラインを担う。

- **Detect**: 登録済みの `EntryRule` 群を順に評価し、検知シグナルを `DetectedSignals` にまとめる
- **Allocate**: `AllocationPolicy.decide(AllocationContext)` を呼び、`LotAllocation`（戦略ごとの配分比率）を得る
- **Size**: 各戦略について `PositionSizingService.executeWithFresh(pair)` を呼び、`SizingResult { lot, rate, requiredMargin }` を取得する（発注直前の鮮度保証レートを使う）
- **Enqueue**: 戦略ごとに `EntryCommand` を組み立てて `EntryQueue.enqueue(command)` に投入する。POST の実レート制限と TTL 破棄は EntryQueue / `GmoRestClient.throttlePost` 側に委譲し、PositionManager は「組み立てて投入する」までで完結する

## 2. 今回のスコープ

**含む**:

- PositionManager（action 層）の新規設計・実装
- LotAllocation（domain 値オブジェクト）+ AllocationPolicy（ドメインサービス interface）+ EqualWeightAllocationPolicy（初期実装）
- DynamicLotCalculator（action 層）
- BalanceCache / BalancePort / GMO BalanceAdapter
- EntryQueue（古シグナル破棄 + 順序保持。POST 1秒1件の実レート制限は `GmoRestClient.throttlePost` に集約）
- 合計ロット上限チェック
- CAPITAL の役割変更（固定資金源 → API 失敗時フォールバック）
- 複数ポジション制約の撤廃
- **`LotPolicy` interface の破壊的変更（R6）**: `calculateLot(pair, slPips)` → `decide(input: LotDecisionInput): Lot` に刷新。既存実装 `MarginBasedLotPolicy` / `RiskBasedLotPolicy` / `FixedRatioLotPolicy` は新 interface に追従し、リネーム（`MarginBasedLotPolicy` → `MaintenanceRatioBasedLotPolicy`）と純粋化（隠れた I/O を排除し `LotDecisionInput` の値だけを使う）を行う

**含まない**:

- RSI 逆張り Rule（#48 Unit ②）
- SMA 乖離逆張り Rule（#49 Unit ③）
- ヒゲ逆張り Rule（#50 Unit ④）
- インジケーター基盤 Composite 化（#47 Unit ①-B）
- 4戦略統合・48時間安定稼働（#55）
- DD 可視化（peak_balance 記録・DD% リアルタイム計算）→ 別 issue に切り出し

**前提**:

- 稼働する Rule は当面 SMA クロスのみ。PositionManager は「将来 Rule が増えても耐える形」で設計するが、動作検証は SMA クロス1本で行う。
- 新規 Rule の具体的な interface（RsiReversalEntryRule 等）は未定義のため、PositionManager は既存の `EntryRule` / `ExitRule` 抽象を扱う形で設計する。

## 3. 受け入れ基準

Issue #51 本文のタスクリストを基準とする:

- [ ] 複数 Rule 結果の統合と戦略ごとのポジション独立管理（action 層）
- [ ] LotAllocation（値オブジェクト、合計=1.0 の不変条件を内部で守る）と AllocationPolicy（ドメインサービス interface）に分離
- [ ] EqualWeightAllocationPolicy を初期実装として提供（等ウェイト配分のみ。上限超過時の制御は PositionManager 側で全件 drop + LogPort.warn / policies.md 1.11）
- [ ] DynamicLotCalculator が GMO API 経由の残高からロットを計算できる
- [ ] 合計ロットが残高ベース上限を超えないチェック
- [ ] エントリー実行キューが「順序保持 + TTL 3秒破棄 + 排他 drain」の責務を満たす（POST 1秒1件の実レート制限は `GmoRestClient.throttlePost` 側で守る、R1 / policies.md 3.4）
- [ ] BalanceCache が 5秒 TTL + API 失敗時フォールバックを満たす
- [ ] CAPITAL 環境変数の役割が「API 失敗時のフォールバック値」に変わる
- [ ] `LotPolicy.decide(input: LotDecisionInput): Lot` 刷新と既存3実装（`MaintenanceRatioBasedLotPolicy` / `RiskBasedLotPolicy` / `FixedRatioLotPolicy`）の追従（R6）
- [ ] `positions` テーブルに `(pair, strategy_name)` の OPEN 状態部分ユニークインデックスを追加（Drizzle migration）（R7）
- [ ] 既存データ整合性確認（CLOSED ポジションは無視）（R7）
- [ ] `DuplicatePositionError` 専用エラー型の定義（R7）

設計書成果物:

- `docs/design/class/position-manager.drawio`（新規）
- `docs/design/sequence/core/multi-strategy-entry.md`（新規）
- `docs/design/sequence/core/multi-strategy-exit.md`（新規）
- `docs/design/sequence/core/tick-to-rule-overview.md`（更新）
- `docs/design/sequence/core/entry-execution.md`（更新）
- `docs/design/sequence/core/market-monitoring.md`（更新）
- `docs/design/sequence/core/startup-flow.md`（更新）
- `docs/design/sequence/adapter/gmo-account-assets.md`（既存。補足整理）
- `docs/design/value-objects.md`（追記: LotAllocation, Ratio, Balance）

## 4. 既存の土台

利用可能な既存資産:

- `src/domain/position/Lot.ts`（完全実装、100〜500,000 / 100倍数）
- `src/domain/position/LotPolicy.ts`（interface のみ）
- `src/domain/position/MarginBasedLotPolicy.ts`（証拠金維持率ベース、現状 CAPITAL を毎回参照）
- `src/domain/position/Position.ts`（完全実装）
- `src/domain/position/StrategyName.ts`（4戦略対応の列挙 VO）
- `src/action/EntryExecution.ts`（単一エントリー処理。`broker.placeEntry` + `Position.open` + `register`）
- `src/domain/command/EntryCommand.ts`（entrySnapshot 必須化済）
- `src/port/Broker.ts` / `PositionRepository.ts`
- `src/adapter/gmo/GmoBrokerAdapter.ts` / `GmoRestClient.ts`（POST スロットリング実装済）
- `src/application/TradingSession.ts`（複数 Rule の for ループ評価）
- `docs/design/sequence/adapter/gmo-account-assets.md`（5秒 TTL + CAPITAL フォールバックまで設計済）
- `docs/design/sequence/adapter/gmo-order-flow.md`（POST 1秒1回制限記載済）
- `docs/design/value-objects.md`（Lot / Price / PositionId 等の設計）
- `positions` テーブルに `strategy_name` カラム存在（Phase 2 で追加）

## 5. 未解決の設計判断（ユーザー確認が必要）

### 5.1 CAPITAL の役割変更と層配置【確定 2026-04-23】

増田亨サブエージェントの DDD レビューに基づき、当初の4案を全て却下し **案 E**（新規提案）を採用。

**層配置**:

| 層 | 担当 |
|---|---|
| `domain/position/` | `LotPolicy` interface（純粋ドメインサービス）+ `MaintenanceRatioBasedLotPolicy` 実装 |
| `domain/` 値オブジェクト | `Lot`, `Balance`, `Money`, `Rate`, `MaintenanceRatio`, `MarginRate`, `LotDecisionInput` |
| `action/` (application) | `PositionSizingService`（残高取得・フォールバック・LotPolicy 呼び出しの組み立て） |
| `port/` (application) | `BalancePort.current(): Balance \| null`（失敗は正直に null を返す） |
| `infrastructure/adapter/` | `GmoBalanceAdapter`（内部で 5秒 TTL を持つが、クラス名には出さない） |

**コード骨子**:

```ts
// domain
interface LotPolicy {
  decide(input: LotDecisionInput): Lot;  // 値オブジェクトで束ねて受ける
}

// application
class PositionSizingService {
  constructor(
    private readonly balancePort: BalancePort,
    private readonly ratePort: RatePort,
    private readonly lotPolicy: LotPolicy,
    private readonly fallbackBalance: Balance,
    /** N-H3: 業者依存の証拠金率は infrastructure 層から注入。ドメインに業者名を漏らさない。 */
    private readonly marginRate: MarginRate,
  ) {}

  execute(pair: CurrencyPair): Lot {
    const balance = this.balancePort.current() ?? this.fallbackBalance;
    const rate = this.ratePort.currentOf(pair);
    return this.lotPolicy.decide(
      // N-H3: LotDecisionInput は 5 引数（pair + balance + rate + target + marginRate）。
      // MarginRate を infrastructure 層から注入するため、パラメータオブジェクトで束ねる。
      LotDecisionInput.of(pair, balance, rate, MaintenanceRatio.of(1.4), this.marginRate),
    );
  }
}
```

**命名変更【確定】**:

- `DynamicLotCalculator` → **`PositionSizingService`**（FX 業界用語 "Position Sizing"）
- `MarginBasedLotPolicy` → **`MaintenanceRatioBasedLotPolicy`**（意図明示）
- `BalanceCache` → **`GmoBalanceAdapter`**（キャッシュは実装詳細）

**却下案の理由（memo）**:

- 案 A: `getCapitalJpy: () => number` は**隠れた I/O**。`capital`（元本）と `balance`（残高）は別概念 → ユビキタス言語の嘘
- 案 B: I/O とロジックの混在で責務違反
- 案 C: Clean Architecture 違反
- 案 D: 引数爆発。パラメータオブジェクト（`LotDecisionInput`）で束ねるのが正解

**CAPITAL のフォールバック位置**: `main.ts` で `Balance.of(Money.jpy(CAPITAL))` と値オブジェクト化し、`PositionSizingService` のコンストラクタに `fallbackBalance` として注入。`Balance` 値オブジェクト自体に fallback 概念は持ち込まない。

**同時含むスコープ拡張（増田亨の Critical 指摘に対応）**:

- **値オブジェクト整備**: `Balance`, `Money`, `Rate`, `MaintenanceRatio`, `MarginRate` を domain に追加（`number` を domain から追い出す）
- **`Rate` の null 排除**: 現状 `getCurrentRate(): number | null` → `Rate` 値オブジェクトで。取れない時は例外で発注中止（古レートで発注しない）
- **残高鮮度保証**: `BalancePort.current()`（キャッシュ OK）と `BalancePort.freshNow()`（発注直前のバイパス取得）を分ける
- **利用可能残高**: 他ポジションの証拠金使用量を引いた**利用可能残高**を `PositionSizingService` で考慮。GMO API の `availableAmount` または自前で差し引く。**二重建てによる証拠金オーバーを防ぐ**

**別 issue 化（スコープ外）**:

- **LotCap（上限ガード）** → **#124**（複利加速抑止）

**`RatePort` の 2 メソッド契約（R4）**:

`RatePort` は次の 2 メソッドを持つ。`null` は返さない（設計憲法 6.7「null を返さない」）。

- `RatePort.currentOf(pair): Rate` — キャッシュ可。通常の判定や表示で使う
- `RatePort.currentFresh(pair): Rate` — **鮮度保証**。発注直前で使う。内部で `Rate.isFreshEnough(now, maxAge)` を判定し、古い場合は throw（古レートでの発注を未然に防ぐ）

> Note: 鮮度判定の閾値（暫定 1 秒）は別 issue で確定する。`PositionSizingService.executeWithFresh(pair)` は `currentFresh(pair)` を使う前提。

**利用可能残高の組み立て（R5）**:

二重建てによる証拠金オーバーを防ぐため、`PositionManager` が利用可能残高を組み立てる。

- **責任分界**: `balance - usedMargin - pendingMargin` を組み立てるのは `PositionManager` の責務である（`PositionSizingService` ではない）。`PositionSizingService` は単一戦略の基準 Lot 算出に専念する
- **一次ソース（確定）**: GMO API の `availableAmount` を**一次採用**する。自前計算（`balance - usedMargin - pendingMargin`）は API 失敗時のフォールバック・整合性検証用
- `pendingMargin = EntryQueue.reservedMargin()`（`EntryQueue` 内で `EntryCommand.requiredMargin` を合算）
- `usedMargin = OpenPositions.totalRequiredMargin()`（`OpenPositions` 集約 API。既存未実装、別 issue で正式追加）

> **Note（Step5 範囲）**: Step5 では `availableAmount` を扱わない。`GmoBalanceAdapter` は `balance` フィールドのみを返す。`availableAmount` を使った利用可能残高ベース上限チェックは `EntryQueue` 完成後（Step6 以降）の別 issue で対応する。詳細は `policies.md` 1.6 PR スコープ Note を参照。

**`EntryCommand.requiredMargin` の追加（R2）**:

`EntryCommand` に `requiredMargin: Money` フィールドを追加する。`SizingResult` から `rate × lot × marginRate` を Big.js で計算して埋める。これにより `EntryQueue.reservedMargin()` は保持済みの `requiredMargin` を合算するだけの純関数になる。

> 実装は **Step 6 で `EntryQueue` 追加と同時に行う**（policies.md 実装ステップ参照）。`value-objects.md` 側は PR #128 で「Step 6 で追加予定」と Note 化済みのため、本ブリーフ確定後に追従修正は不要。

**`MarginRate` の業者依存値分離（R10）**:

- `MarginRate.gmoFxRetail()` のような**業者依存の static factory はドメイン VO に置かない**。ドメインに業者名が漏れると、他ブローカー対応時にドメインモデルが業者ごとに分岐し始め純粋性が壊れる
- 代わりに `infrastructure/gmo/GmoConstants.MARGIN_RATE = MarginRate.of('0.04')` を定義し、`main.ts` で `PositionSizingService` のコンストラクタに `marginRate` として DI 注入する
- 値そのもの（0.04）は infrastructure 側コンフィグ、型（`MarginRate`）はドメイン側、という分離を維持する

> `value-objects.md` 側は PR #128 でこの方針に追従済み（H9 Note）。本ブリーフ確定後に追従修正は不要。

### 5.2 AllocationPolicy の方針【確定 2026-04-23】

DDD レビュー（増田亨サブエージェント）と金融アナリストレビューの結果、以下を採用。

**命名**: `StrategyWeight` を廃止し、2概念に分離:

- `LotAllocation`（値オブジェクト、domain/allocation/）: 「A:0.7, B:0.3」等の**配分結果**。合計=1.0 の不変条件を内部で守る。Map を露出させず `ratioOf(s)` / `isSuppressed(s)` で問える
- `AllocationPolicy`（ドメインサービス interface、domain/allocation/）: 検知シグナル・保有ポジション・残高から `LotAllocation` を返す**判断ロジック**
- `AllocationContext`（値オブジェクト）: Policy の入力を束ねる（`CurrencyPair`, `DetectedSignals`, `OpenPositions`, `Balance`）。pair は配分判断対象の通貨ペアで、Policy 側は本 pair 限定で保有戦略を抑制する（multi-pair 時の異 pair 同戦略の誤抑制防止 / N-A1）

**初期実装**: `EqualWeightAllocationPolicy`

- 検知された戦略のうち、対象 pair で既に保有中の戦略は抑制（`OpenPositions.holdsStrategyOnPair(pair, strategy)` 経由）
- 抑制後に残った N 戦略（= eligible.length）に等ウェイト配分（残数 N に対し 1/N × N）
- 合計ロットが単一 Lot 上限を超える場合は **PositionManager 側で全件 drop + `LogPort.warn`** が確定方針（policies.md 1.11）。維持率ベースの事前スケールダウンが必要になった時点で AllocationPolicy 側に責務を寄せる（本 Policy では行わない）
- 根拠: 金融アナリスト「等ウェイトは無知に対する最適解。Kelly 誤差ペナルティも小さい（DeMiguel 2009）」

**残余寄せルール（EqualWeightAllocationPolicy の比率決定アルゴリズム, N-H5）**:

`Ratio` は小数第 10 位で丸めるため、等ウェイト N=3 や N=7 では単純加算で合計が 1.0 にならない（例: 1/3 = 0.3333333333 × 3 = 0.9999999999）。合計=1.0 の不変条件を厳密に保つため、以下のアルゴリズムを採用:

1. 検知戦略数 `n` から理論比率 `r = 1/n` を計算（Big.js で 10 桁、切り捨て丸め）
2. 先頭 `n-1` 戦略に `r` を割り当て
3. 最後の戦略に `1 - (n-1) × r` を割り当て（= 残余を末尾に寄せる）
4. これにより合計 = 1.0 を厳密に保つ

**例**:

- n=3 → r=0.3333333333、末尾=0.3333333334（合計 1.0000000000）
- n=7 → r=0.1428571428、末尾=0.1428571432（合計 1.0000000000）
- n=10 → r=0.1000000000、末尾=0.1000000000（残余ゼロ、均等）

**注意**: 「末尾にどの戦略が来るか」は `detectedSignals` の順序に依存する。順序依存を避けたい場合は戦略名でソート済みの順で処理する（将来検討）。現状は `AllocationContext.detectedSignals()` の順序をそのまま使う。

**`LotAllocation.of` の合計検証**: 残余寄せにより誤差は `Ratio.EPSILON`（1e-9）内に収まるため、`LotAllocation.of` は `sum - 1.0 の絶対値 > Ratio.EPSILON` の場合に throw する（value-objects.md `LotAllocation` 章の合計検証 Note 参照）。

**今回やらないこと（別 issue）**:

- 固定比率（A+B → 7:3、A+B+F → 1:4:5）+ 離散抑制（A 保有中に B 半減・C 発動抑止）→ **#120** `FixedRatioAllocationPolicy` + `SuppressionRule`（Specification パターン）
- 相関/リスク予算/Kelly ベース配分 + 連続減衰 → **#121** `RiskBudgetedAllocationPolicy`
- ボラティリティターゲティング（ATR・実現ボラで Lot 動的調整）→ **#122** `VolatilityTargetingLotPolicy`

**TradingGuard との責務境界【確定】**:

- **TradingGuard**: 市場環境起因の「**全停止**」と既存ポジション強制決済（経済指標・APIメンテ・異常検知）。最大権力
- **AllocationPolicy**: 取引可能状態の中で「**戦略組合せ起因の配分調整**」

抑制条件を将来追加する際は、「全停止系」は TradingGuard、「戦略ごとの配分調整系」は AllocationPolicy と分離する。両者で二重化させない。

**ConvictionScore（#57）との接続**:

`AllocationContext` に `ConvictionScores` を追加し、`ConvictionWeightedAllocationPolicy` を実装することで対応。既存 Policy は差し替えで済む。

### 5.3 複数 Rule 同時シグナル時のロット競合解消【5.2 に統合】

AllocationPolicy の責務に吸収。初期実装（EqualWeight）では検知シグナル全てに等ウェイト配分する。合計ロットが単一 Lot 上限を超える場合は **PositionManager 側で全件 drop + LogPort.warn**（policies.md 1.11）。維持率ベースの事前スケールダウンが必要になった時点で AllocationPolicy 側に責務を寄せる（5.2 末尾と整合）。

### 5.4 複数ポジション制約の撤廃方針【確定 2026-04-23】

**方針**: `position_id` を単独主キーとし、`(pair, strategy_name)` の **OPEN 状態ユニーク制約**で「戦略ごとに1ポジション」を強制。

- DB 制約（部分ユニークインデックス: `WHERE status = 'OPEN'`）で整合性を守る
- 同一 pair 同一 strategy で CLOSED は何本あってもよい
- 将来「同戦略で複数ポジション」を許容したくなった時は、制約を緩和するだけ（広げるより絞る方が安全）
- ExitRule 評価ループは `(pair, strategy_name)` でポジションを引いて戦略別に評価

**GMO 両建て設定**: `isHedgeable: true` は従来通り。両建て自体は「BUY と SELL を同時に持つ」ことであり、「同戦略複数ポジション」とは直交する論点。

**ドテンレース時の UNIQUE 違反対策（R8）**:

同 tick 内で `evaluateExit → evaluateEntry`（ドテン）が走る場合、決済 commit と新規 insert のレースが部分ユニーク制約違反を起こしうる。これに対する**2 段防御**を採る:

1. **アプリ層（一次防御）**: `PositionRepository.findOpenByPairAndStrategy(pair, strategy)` で事前チェックし、既存 OPEN があれば enqueue しない
2. **DB 層（最終防衛線）**: `(pair, strategy_name)` の OPEN 状態部分ユニーク制約。アプリ層をすり抜けたケースを最終的に止める

DB 制約違反は `DuplicatePositionError` で捕捉し、`AlertPort.notify('info', 'duplicate entry suppressed')` で観測可能にする。発注は中止し、後続 tick で改めて評価する（リトライしない）。

### 5.5 EntryQueue の粒度【確定 2026-04-23】

**方針**: action 層の**独立コンポーネント**として `EntryQueue` を実装。PositionManager が DI で利用。

- 配置: `action/EntryQueue.ts`
- 責務（R1, 確定）: **「古シグナル破棄 + 順序保持」に専念**。POST 1秒1件の**実レート制限は `GmoRestClient.throttlePost`（既存実装）に集約**する。EntryQueue 側で 1秒制限を守る必要はない（責務分離: queue は「順序保持 + TTL 破棄 + 排他 drain」、レート制限は HTTP 層）
- バックプレッシャー: **古いシグナル破棄**。入力時刻から 3 秒経過したシグナルは Queue から破棄（FX は鮮度が命、古シグナルで古値に発注されるリスクを避ける）
- タイムアウト値（3秒）は設定値として外出し可能に

**責務分担表（R1）**:

| コンポーネント | 担当 |
|---|---|
| `EntryQueue` | 順序保持 + TTL 破棄 + 排他 drain |
| `GmoRestClient.throttlePost`（既存実装） | 1 秒 1 件の実レート制限 |

> `GmoRestClient.throttlePost` は既存実装あり（`packages/backend/src/adapter/gmo/GmoRestClient.ts:175`）。本責務分担は既存実装の挙動と一致するため、実装追加は不要。policies.md 3.4 と整合。

**`EntryQueue` の interface 配置（R9）**:

> Note: `EntryQueue` は実装クラスとして **action 層に直接配置**する（port を介さない）。理由: 単一実装で port 抽象化のメリットがなく、テストでは `Clock` 注入で十分制御できるため。将来別実装（例: 永続化付きキュー）が必要になった時点で `EntryQueuePort` を切り出す（YAGNI）。

**根拠**:

- 独立コンポーネントにする理由: 単体テスト可能、責務明確（「鮮度保証」は TradingSession / AllocationPolicy の関心ではない）、将来 PositionManager 以外から使える
- 古シグナル破棄の理由: 金融アナリスト指摘「FX は鮮度が命」。5秒前のシグナルを今発注しても値が動いている可能性が高い

## 6. 次のステップ

1. 本ブリーフをユーザーと合意
2. 5. の未解決項目をユーザー確認で確定（ブリーフに決定を追記）
3. PositionManager 中心のクラス図をサブエージェントで作成
4. 多戦略エントリー・決済シーケンスをサブエージェントで作成
5. VO / CAPITAL 方針 / DD 設計の追記
6. 全体レビュー後、position-manager/main から design PR を切って develop へ（人間がマージ）

---
