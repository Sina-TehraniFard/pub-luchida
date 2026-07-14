# PositionManager 方針ドキュメント（実装詳細）

> Issue #51 の `brief.md` 5.1 / 5.2 / 5.4 / 5.5 の決定内容を、実装担当者向けに掘り下げた補助資料。
>
> - `brief.md` = 「何を決めたか」「なぜその決定か」
> - `policies.md`（本書）= 「その決定をどう実装するか」「既存コードとどう整合させるか」「マイグレーションパス」「テスト観点」

## 前提条件

- **PR #128（brief.md / value-objects.md 改訂）が既に `position-manager/main` にマージされている前提**で書かれている。具体的には:
  - `brief.md` 5.1 が `LotDecisionInput` 5 引数化（`pair`, `balance`, `rate`, `target`, `marginRate`）に更新済み
  - `brief.md` 5.2 に残余寄せアルゴリズム（N-H5）が追記済み
  - `value-objects.md` に設計憲法 6.1〜6.11 が追加済み
  - `TotalUnits` / `StrategyLots` / `AllocationContext` が VO として定義済み
  - `Ratio.EPSILON: Big` と `Ratio.addUnchecked` が追加済み
  - `MarginRate.gmoFxRetail()` は**削除済み**（6.1 節 H9 / `MarginRate` Note 参照）。業者依存値は infrastructure 層から DI で注入する
- **issue #130（`StrategyName` singleton 化）は未完了**。本書のコード例は、`StrategyName` VO のキー等価性が壊れる前提で、`Map<StrategyNameValue, X>`（string literal union をキー）に統一する（`value-objects.md` 6.6 節 N-C1）。singleton 化完了後に Map キーを `StrategyName` 自体へ戻す書き換えは別 PR で行う
- **issue #131（`CurrencyPair` の `base` / `quote` / `pipUnit` 追加）は本 PR (#137) で完了**。`CurrencyPair` は branded string（識別子的 VO のため演算を持たない）として継続採用し、API は module-level 関数 `base(pair)` / `quote(pair)` / `pipUnit(pair)` として `domain/market/CurrencyPair.ts` から export される。`pipUnit` は設計憲法 6.1 に従い `Big` を返す。本書 1 章（`MaintenanceRatioBasedLotPolicy`）の実装は `quote(pair)` に依存する
- 対象ブランチ: `position-manager/main`
- 関連 Issue: #51（本体）, #130（singleton 化）, #131（`CurrencyPair` 拡張）

## 目次

1. CAPITAL 役割変更（brief 5.1 の詳細）
2. 複数ポジション制約（brief 5.4 の詳細）
3. EntryQueue（brief 5.5 の詳細）
4. 横断事項（LogPort + UiNotifier の使い分け / マイグレーション順 / brief 改訂候補 / 設計憲法対応表）

---

## 1. CAPITAL 役割変更

> **冒頭 Note（5 引数 `LotDecisionInput`）**:
>
> `LotDecisionInput` は brief 5.1 の確定形で **5 引数**（`pair`, `balance`, `rate`, `target`, `marginRate`）。`MarginRate` は業者依存値であり、`MarginRate.gmoFxRetail()` は削除済み。adapter 層（`adapter/gmo/GmoConstants`）から `MarginRate.of('0.04')` を生成して `PositionSizingService` コンストラクタに DI する（`value-objects.md` 6.1 / N-H9）。本章のコード例はすべてこの前提で書く。
>
> また本章の Big 計算経路では `toNumber()` / `toString()` は**再計算の入力にしない**（設計憲法 6.1）。`Big` → `number` 変換は最終的に `Lot.of(number)` に渡す時点に限定する。

### 1.1 現状コードの問題点

`packages/backend/src/main.ts` L120〜L139 と `packages/backend/src/domain/position/MarginBasedLotPolicy.ts` に問題がある。

#### 1.1.1 `main.ts` — CAPITAL の使い方が「固定資金源」のまま

```ts
// 現状: L131-139
const CAPITAL = Number(process.env.CAPITAL);
let latestRate: number | null = null;
const lotPolicy = new MarginBasedLotPolicy(
  () => CAPITAL,                 // ① 毎回同じ固定値を返す
  () => latestRate,              // ② number | null で返す
  TARGET_MAINTENANCE_RATIO,
  MARGIN_RATE,
);
```

問題点:

- ① `CAPITAL` は**元本**（入金額）を表す概念で使われているが、維持率計算に使いたいのは**現在残高**（`balance`）。`capital` と `balance` はドメインで別物（brief 5.1 案 A の却下理由）
- ② `latestRate` は `MarketDataStream` のコールバックで書き換えられる可変の closure 変数。ドメイン層に `number | null` を流し込んでいる
- `LotPolicy` のコンストラクタが I/O 関数（`() => number`）を受け取っており、純粋ドメインサービスとして成立していない（brief 5.1 案 C 却下理由）

#### 1.1.2 `MarginBasedLotPolicy.ts` — I/O とロジックの混在

```ts
// 現状 L26-39
constructor(
  private readonly getCapitalJpy: () => number,     // I/O
  private readonly getCurrentRate: () => number | null,  // I/O
  private readonly targetMaintenanceRatio: number,
  private readonly marginRate: number = 0.04,
) { ... }

calculateLot(pair: CurrencyPair, _slPips: number): Lot {
  const capital = this.getCapitalJpy();   // 呼び出し時点で I/O
  const rate = this.getCurrentRate();     // 呼び出し時点で I/O
  if (rate === null) { throw ... }        // null チェックをロジック側で
  ...
}
```

問題点:

- ドメインサービスが**呼び出し時に副作用**を持つ。単体テストで「同じ入力で同じ出力」が保証されない
- `slPips` が引数にあるのに未使用（`_slPips`）。維持率ベースでは不要な引数が残っており、`LotPolicy` の interface が歪んでいる
- `rate === null` のケアがドメインで必要。呼び出し側の責務として上に押し出したい
- `marginRate: number = 0.04` が実装クラスのデフォルト引数にハードコードされている（業者依存値のドメイン混入。H9 / N-H9 で禁止）

### 1.2 目指す状態（案 E）

brief 5.1 で採用した**案 E**の層配置を、実装ファイル単位に落とす。

| 層 | ファイル | 役割 |
|---|---|---|
| `domain/position/` | `LotPolicy.ts`（既存。interface 書き換え） | 純粋ドメインサービス interface |
| `domain/position/` | `MaintenanceRatioBasedLotPolicy.ts` | 純粋実装。引数は `LotDecisionInput` 一つ |
| `domain/` | `Money.ts` / `Balance.ts` / `Ratio.ts` | 値オブジェクト |
| `domain/market/` | `Rate.ts` / `CurrencyPair.ts`（#131 拡張対象） | 値オブジェクト |
| `domain/position/` | `MaintenanceRatio.ts` / `MarginRate.ts` / `LotDecisionInput.ts` / `TotalUnits.ts` | 値オブジェクト |
| `domain/allocation/` | `LotAllocation.ts` / `StrategyLots.ts` / `AllocationPolicy.ts` / `AllocationContext.ts` / `EqualWeightAllocationPolicy.ts` | 配分ドメイン |
| `application/` | `PositionSizingService.ts`（新規） | 残高・レート取得 → `LotPolicy` 呼び出しの組み立て |
| `port/` | `BalancePort.ts` / `RatePort.ts` / `Clock.ts` | 抽象 |
| `adapter/gmo/` | `GmoBalanceAdapter.ts` 等 | 実装。内部で 5 秒 TTL を持つがクラス名には出さない |
| `adapter/gmo/` | `GmoConstants.ts` | `MARGIN_RATE = MarginRate.of('0.04')` を定義（業者依存値の置き場） |
| Composition Root | `main.ts` | `Balance.of(Money.jpy(CAPITAL))` を生成 + `GmoConstants.MARGIN_RATE` を DI 注入 |

> **配置の整合性メモ**: 本リポは既存 `packages/backend/src/action/` に `EntryExecution.ts` 等を置いており、brief は `action/` 層と呼んでいる。一方 `TradingSession.ts` は `application/` 直下にあるため、新規 `PositionSizingService` は **`src/application/`** に置く（brief 改訂候補 P1）。

### 1.3 命名変更の詳細マッピング

| 変更前 | 変更後 | 配置 | 状態 |
|---|---|---|---|
| `DynamicLotCalculator` | **`PositionSizingService`** | `src/application/PositionSizingService.ts` | 新規 |
| `MarginBasedLotPolicy` | **`MaintenanceRatioBasedLotPolicy`** | `src/domain/position/MaintenanceRatioBasedLotPolicy.ts` | 既存をリネーム + 書き換え |
| `BalanceCache` | **`GmoBalanceAdapter`** | `src/adapter/gmo/GmoBalanceAdapter.ts` | 新規 |
| — | `BalancePort` | `src/port/BalancePort.ts` | 新規 |
| — | `RatePort` | `src/port/RatePort.ts` | 新規 |
| — | `Clock` | `src/port/Clock.ts` | 新規（`SystemClock` 実装は `src/infrastructure/time/SystemClock.ts`） |

**テストファイルも対応**:

- `MarginBasedLotPolicy.test.ts` → `MaintenanceRatioBasedLotPolicy.test.ts`
- `PositionSizingService.test.ts` 新規作成

### 1.4 PositionSizingService の責務詳細

```ts
// src/application/PositionSizingService.ts（骨子）
import { BalancePort } from '../port/BalancePort.js';
import { RatePort } from '../port/RatePort.js';
import { LotPolicy } from '../domain/position/LotPolicy.js';
import { Balance } from '../domain/Balance.js';
import { MaintenanceRatio } from '../domain/position/MaintenanceRatio.js';
import { MarginRate } from '../domain/position/MarginRate.js';
import { LotDecisionInput } from '../domain/position/LotDecisionInput.js';
import { CurrencyPair } from '../domain/market/CurrencyPair.js';
import { Lot } from '../domain/position/Lot.js';

export class PositionSizingService {
  constructor(
    private readonly balancePort: BalancePort,
    private readonly ratePort: RatePort,
    private readonly lotPolicy: LotPolicy,
    private readonly fallbackBalance: Balance,   // main.ts で CAPITAL から生成
    private readonly target: MaintenanceRatio,   // 初期値 MaintenanceRatio.of('1.4')
    private readonly marginRate: MarginRate,     // adapter/gmo/GmoConstants.MARGIN_RATE から DI（H9）
  ) {}

  /**
   * 通常のサイジング（キャッシュ残高 OK）。
   * Rule 発火時の基準 Lot 算出に使う。
   * Rate が未到着（`currentOf` が null）なら `RatePortError.notYetAvailable` を throw
   * （呼び出し側の PositionManager が当該 pair を skip）。
   */
  execute(pair: CurrencyPair): Lot {
    const balance = this.balancePort.current() ?? this.fallbackBalance;
    const rate = this.ratePort.currentOf(pair);
    if (rate === null) {
      throw RatePortError.notYetAvailable(pair);
    }
    const input = LotDecisionInput.of(pair, balance, rate, this.target, this.marginRate);
    return this.lotPolicy.decide(input);
  }

  /**
   * 発注直前の鮮度保証サイジング。
   * エントリー発注直前で「最新残高 / 最新レート を取り直す」局面で使う。
   * 取れなかった場合は fallback せず throw（エントリーは中止させる＝brief 5.1）。
   *
   * `BalancePort.freshNow()` は HTTP 経由のため Promise を返し、本メソッドも async になる。
   * 戻り値は `SizingResult` VO（`{ lot, rate, requiredMargin }`）。
   * NH-2 対応: PositionManager 側で再度 `RatePort.currentFresh` を呼ばず、ここで使った rate /
   * 計算済み requiredMargin を `EntryCommand` 構築に流用させる（レート二重取得回避）。
   */
  async executeWithFresh(pair: CurrencyPair): Promise<SizingResult> {
    const balance = await this.balancePort.freshNow();    // 取れなければ throw
    const rate = this.ratePort.currentFresh(pair);        // 鮮度保証版（6.9 節）
    const input = LotDecisionInput.of(pair, balance, rate, this.target, this.marginRate);
    const lot = this.lotPolicy.decide(input);
    return SizingResult.of(lot, rate, this.marginRate);   // requiredMargin は内部で計算
  }
}
```

> **Note (SizingResult VO 新設 / NH-2)**: `SizingResult` は `domain/position/SizingResult.ts` に新設する VO。フィールドは `lot: Lot` / `rate: Rate` / `requiredMargin: Money`。`SizingResult.of(lot, rate, marginRate)` ファクトリで `requiredMargin = rate × lot × marginRate` を Big で計算して保持する。**value-objects.md L1433 に反映済**（4.4 節 P14）。Step 4（PositionSizingService 追加）と同 PR で実装側を追加する。

**戦略配分対応（多戦略）の当面の方針**:

- brief 5.2 で `AllocationPolicy` が `LotAllocation`（比率の束）を返す
- `PositionManager` は検知された戦略集合に対して `sizingService.execute(pair)` を 1 回呼び、**基準 Lot** を得る
- 各戦略の最終 Lot は `allocation.apply(baseLot)` が返す `StrategyLots` から `strategyLots.lotOf(strategy)` で引く（value-objects.md `StrategyLots` 参照）
- `LotAllocation.suppressed(strategies)` が返った場合（= 全戦略抑制）、`PositionManager` は `EntryQueue` に何も流さず `DoNothing` 相当で終える。また `allocation.isFullySuppressed()` で早期判定できる（value-objects.md `LotAllocation` 参照）
- **多戦略一括処理（`execute(pair, allocation): StrategyLots`）は当面やらない**（brief 改訂候補 P2）

> **重要（C3 対応）**: 以前の版で「`allocation.apply(baseLot).get(strategy)`」と書いていた箇所は誤り。`LotAllocation.apply()` は生 `Map` を返さず `StrategyLots` を返す。`.get()` は存在せず、必ず `strategyLots.lotOf(strategy): Lot | null` / `strategyLots.strategies()` / `strategyLots.totalLot(): TotalUnits` を使う（`StrategyLots` は生 `Map` を API 境界に露出させない設計）。

#### 1.4.1 AllocationPolicy 呼び出し

`AllocationPolicy.decide()` は `AllocationContext` を受け取る:

```ts
import { AllocationContext } from '../domain/allocation/AllocationContext.js';

const detectedSignals = /* DetectedSignals */;
const openPositions = await positionRepository.openPositions();
const balance = await balancePort.freshNow();

const context = AllocationContext.of(pair, detectedSignals, openPositions, balance);
const allocation = allocationPolicy.decide(context);  // LotAllocation
if (allocation.isFullySuppressed()) return;  // 全戦略抑制

const baseLot = sizingService.execute(pair);
const strategyLots = allocation.apply(baseLot);  // StrategyLots
```

> **Note (`pair` を含める / N-A1)**:
> - `AllocationContext` は **pair を内包する**。Policy は `context.currentPositions().holdsStrategyOnPair(context.pair(), strategy)` を呼び、本 pair に紐づく保有戦略のみを抑制対象にする。
> - これにより multi-pair 同時運用時に「USD/JPY で SMA_CROSS シグナル発火 / EUR/JPY で SMA_CROSS 保有中」のケースで USD/JPY 側の SMA_CROSS が誤抑制されることを防ぐ（multi-pair 拡張時の前提）。
> - `OpenPositions` 側に pair 限定の述語（`holdsStrategyOnPair`）と集合一括 API（`heldStrategyNamesFor`）を持たせ、Policy が `Position.strategyName` の内部表現に直接依存しないようにする（カプセル化 / Tell, Don't Ask）。
>
> **Note (`detectedSignals` の型 / NM-3)**:
> - `detectedSignals: DetectedSignals` VO（value-objects.md `DetectedSignals` 章 / 本 PR で実装済）。

### 1.5 BalancePort / RatePort の 2 メソッド使い分け

```ts
// src/port/BalancePort.ts
export interface BalancePort {
  /**
   * キャッシュ値を返す。TTL 内ならキャッシュヒット。
   * 未取得・期限切れは null を返す（port 層の許容、設計憲法 6.7）。
   * 用途: Rule 発火時の基準 Lot 算出。古い値でも許容し、発注中止よりフォールバック優先。
   */
  current(): Balance | null;

  /**
   * キャッシュがフレッシュならその値、そうでなければ API 直叩き。最新残高を保証する。
   * 取得失敗時は例外 throw（null を返さない）。
   * HTTP 経由のため Promise を返す（implementation note）。
   * 用途: エントリー発注直前の鮮度保証。
   */
  freshNow(): Promise<Balance>;
}

// src/port/RatePort.ts
export interface RatePort {
  /**
   * 鮮度非保証の現在レート。初回 tick 未到着時は null。
   * 用途: Rule 発火時の基準 Lot 算出（呼び側で null → 該当 pair skip）。
   */
  currentOf(pair: CurrencyPair): Rate | null;

  /**
   * 発注直前の鮮度保証版。`Rate.isFreshEnough` に通らなければ throw（`RatePortError`）。
   * 設計憲法 6.9 参照: Rate VO 自体は「取得手段」を知らない。鮮度判定は RatePort 実装が担う。
   */
  currentFresh(pair: CurrencyPair): Rate;
}
```

`current()` / `freshNow()` / `currentOf()` / `currentFresh()` の呼び分け方針:

| 呼び出しポイント | メソッド | 失敗時の挙動 |
|---|---|---|
| `PositionManager.handleSignals` 冒頭（残高・ポジション一括取得） | `BalancePort.freshNow()` + `RatePort.currentFresh(pair)` | 発注中止 + `LogPort.warn(...)`（4.1 節） |
| Rule 発火時の基準 Lot 算出（通常ケース） | `BalancePort.current()` → fallback, `RatePort.currentOf(pair)` | `current()` が null なら fallback で続行。`currentOf` が throw なら該当 pair skip |
| 診断・UI 表示 | `BalancePort.current()` | null 許容 |

> **brief との突き合わせメモ**: brief 5.1 の文面は「`BalancePort.current()` と `BalancePort.freshNow()` を分ける」。`multi-strategy-entry.md` のフロー図では「PM → BP: freshNow()」を最上流で一度だけ呼ぶ設計。`PositionSizingService.execute()` で `current()` を使うのは「すでに PM が `freshNow()` で取った Balance を引数で渡す」パターンに変える可能性がある（brief 改訂候補 P3）。

### 1.6 利用可能残高（availableBalance）の計算

brief 5.1「二重建てによる証拠金オーバーを防ぐ」の実装方針。

#### 1.6.1 採用パターン: GMO API `availableAmount` を一次採用（A）+ 自前計算（B）はフォールバック

**brief 5.1 R5 で確定**: GMO API の `availableAmount` を**一次ソース**として採用する。自前計算（`balance - usedMargin - pendingMargin`）は API 失敗時のフォールバック・整合性検証用に位置付ける。

理由:
- GMO 側が**含み損益込み**で利用可能な実額を返すため、自前計算より正確（自前差分は含み損益を反映できない）
- API メンテ・通信障害時の冗長性として自前計算を保持する

**一次経路（A）**:

```ts
// BalancePort 拡張（issue 起票候補）
interface BalancePort {
  current(): Balance | null;             // 純残高（既存方針）
  freshNow(): Promise<Balance>;          // 純残高、鮮度保証（HTTP 経由のため Promise）
  availableAmount(): AvailableBalance;   // 含み損益込み利用可能残高（一次）
}
```

`PositionManager` は `availableAmount()` を直接受け取り、`AllocationContext` に渡す。

**フォールバック経路（B）**: API 失敗時のみ:

```ts
// PositionManager.handleSignals 内（API 失敗フォールバック）
const balance = await balancePort.freshNow();
const openPositions = await positionRepository.openPositions();
const usedMargin = openPositions.totalRequiredMargin();
const pendingMargin = entryQueue.reservedMargin();
const availableMoney = balance.toMoney().minus(usedMargin).minus(pendingMargin);
const availableBalance = Balance.of(availableMoney);  // 負なら Balance.of 側で throw
// → logger.warn('availableAmount API failed, fallback to local calc')（4.1 節）
```

`balance.minus()` / `Money.minus()` が負になる場合は `Balance` 側が throw する。**負になったら即発注中止 + `LogPort.error(...)`（補償ドメイン処理は別途起動）** が `PositionManager` の責務（見落とし 10 対応 / 4.1 節 Note: 旧 `critical` は `LogPort.error` で記録 + 補償処理を即時起動）。

> **OpenPositions 側 API（M7 / 見落とし 2）**: `openPositions.totalRequiredMargin(): Money` は既存実装に未追加。フォールバック経路でのみ必要。`value-objects.md` の `OpenPositions` Note（N-M1）の通り、戦略別 / 集約系 API の正式追加は別 issue で追跡する。暫定はループ合算でよい。

> **`AvailableBalance` 値オブジェクト切り出し**: brief 改訂候補 P4（設計憲法 6.3 H1）。`Balance` と区別する型を持たせるかは別 issue で確定。

#### 1.6.2 `availableBalance` は誰の責務か

| コンポーネント | 責務 |
|---|---|
| `BalancePort` / `GmoBalanceAdapter` | `current()` / `freshNow()`（純残高）+ `availableAmount()`（含み損益込み利用可能残高、一次）を返す |
| `PositionSizingService` | 単一戦略の基準 Lot 算出。`balance`（純残高）を受け取る |
| `PositionManager` | 一次経路: `availableAmount()` を直接 `AllocationContext` に渡す。フォールバック経路: `balance - usedMargin - pendingMargin` を組み立て |

`AllocationContext` に渡す `Balance` は**利用可能残高**（含み損益込み）。発注直前に合計ロット上限を判定する際に必要。

#### 1.6.3 `pendingMargin` の取得源

multi-strategy-entry.md の Note と brief 改訂候補 P5 に従い、**当面は `EntryQueue.reservedMargin(): Money`** を採用。理由:

- PENDING を DB に入れると、ゴーストポジション補償（multi-strategy-entry.md Note）との状態遷移が複雑化する
- EntryQueue 内なら「enqueue → drain → 発注 API 成功」のライフサイクルで自然に除外できる
- 案 B（DB PENDING）は将来、より厳密な整合性が必要になった時点で移行する（brief 改訂候補 P9）

> **PR スコープ整理（1.5 / 1.6 統合）**:
>
> - **Step5 PR（本系列）で導入する `BalancePort` の API は `current()` / `freshNow()` の 2 メソッドのみ**。`availableAmount(): AvailableBalance` は Step5 範囲外で、別 issue（P4 + GMO API 突合せ）として切り出す。
> - 1.6.1 一次経路（A）は `availableAmount()` 採用が確定方針だが、実装としてはまず `current()` / `freshNow()` で純残高を返し、`PositionManager` 側のフォールバック経路（B）相当の自前計算で運用を始める。`availableAmount()` の port 追加と GmoBalanceAdapter 実装は P4 issue 切り出しで別 PR。
> - したがって Step5 PR では `BalancePort` interface に `availableAmount()` を追加しない。1.6 章の記述は将来計画として保持。

### 1.7 CAPITAL フォールバックの配置

> **PR スコープ Note**: 本節の `main.ts` 書き換え（`Balance.of(Money.jpy(...))` 化、`/^\d+$/` バリデーション、`PositionSizingService` 注入）は **Step5 PR の範囲**。Step4 PR 時点では `latestRate` closure と `Number(CAPITAL)` を残したまま `LotPolicy` interface 刷新と Rule 配線の差し替えに留める（1.8 節冒頭の境界 Note 参照）。

`main.ts` の DI 組み立てを以下のように書き換える。

```ts
// 新: main.ts（CAPITAL → Balance 化）
import { Balance } from './domain/Balance.js';
import { Money } from './domain/Money.js';
import { MaintenanceRatio } from './domain/position/MaintenanceRatio.js';
import { MaintenanceRatioBasedLotPolicy } from './domain/position/MaintenanceRatioBasedLotPolicy.js';
import { PositionSizingService } from './application/PositionSizingService.js';
import { GmoBalanceAdapter } from './adapter/gmo/GmoBalanceAdapter.js';
import { GmoConstants } from './adapter/gmo/GmoConstants.js';

if (!process.env.CAPITAL) {
  throw new Error('CAPITAL 環境変数が未設定です。API 失敗時のフォールバック値として使用します');
}
// H11: CAPITAL は整数文字列のみ許容。指数表記（1e6 等）や小数は禁止
if (!/^\d+$/.test(process.env.CAPITAL)) {
  throw new Error(`CAPITAL は整数文字列で指定してください（指数表記・小数禁止）: ${process.env.CAPITAL}`);
}

const fallbackBalance = Balance.of(Money.jpy(process.env.CAPITAL));  // string を Money.jpy に渡す（設計憲法 6.1）

const balancePort = new GmoBalanceAdapter(restClient, new SystemClock());
const ratePort = /* MarketDataStream から最新 tick を Rate に変換する Adapter（brief 改訂候補 P6） */;

const lotPolicy = new MaintenanceRatioBasedLotPolicy();  // 純粋ドメインサービス（状態なし）

const sizingService = new PositionSizingService(
  balancePort,
  ratePort,
  lotPolicy,
  fallbackBalance,
  MaintenanceRatio.of('1.4'),     // 設計憲法 6.1: string 推奨
  GmoConstants.MARGIN_RATE,       // = MarginRate.of('0.04')（adapter/gmo DI / H9）
);
```

**重要**:

- `Balance` 値オブジェクト自体に「fallback かどうか」のメタは持たせない（設計憲法 6.3）
- `CAPITAL` の**意味は変わる**: 「元本（固定資金源）」→「API 失敗時のフォールバック残高」。`.env` サンプルのコメントを更新
- 環境変数名 `CAPITAL` は維持（破壊的変更を避ける）。`FALLBACK_BALANCE_JPY` へのリネームは brief 改訂候補 P7
- `MarginRate` は必ず adapter 層（`adapter/gmo/GmoConstants.MARGIN_RATE`）から注入。`MarginRate.gmoFxRetail()` は**削除済みのため呼ばない**（value-objects.md `MarginRate` Note / H9）

### 1.8 既存コードからのマイグレーションパス

段階的にコミットを分割する前提で、以下の順に進める。

> **PR 単位の境界（lot-policy-refactor 実装スコープ）**:
>
> 本書の Step 0〜Step 12 は粒度の細かい段取り表だが、実装担当の PR としては以下 2 段階に束ねる:
>
> - **Step4 PR（本 PR スコープ / `feat/lot-policy-refactor`）**:
>   - `LotPolicy` interface 刷新（`decide(input: LotDecisionInput): Lot` への一本化、`calculateLot(pair, slPips)` 削除）
>   - 既存 3 実装の追従: `MarginBasedLotPolicy` → `MaintenanceRatioBasedLotPolicy` への rename + 書き換え、`RiskBasedLotPolicy` / `FixedRatioLotPolicy` の interface 追従
>   - `main.ts` / `SmaCrossEntryRule` の配線修正（`() => lotPolicy.decide(input)` への切替まで。`latestRate` closure / `CAPITAL` Number 化はまだ残してよい）
>   - `LotAllocation` / `StrategyLots` を `domain/position/` から `domain/allocation/` へ移動（Step 1 の置き場確定）
>   - `MarginBasedLotPolicy.test.ts` → `MaintenanceRatioBasedLotPolicy.test.ts` への rename（Step 2 完了条件 / NL-3）
>   - 上記スコープは細粒度 Step で言うと **Step 1（VO 配置確定）+ Step 2（LotPolicy 刷新）** に相当
>
> - **Step5 PR（次 PR）**:
>   - `SizingResult` VO 新設（`domain/position/SizingResult.ts` / 4.4 節 P14）
>   - `BalancePort` / `RatePort` / `Clock` の port 追加 + `SystemClock` 実装
>   - `GmoBalanceAdapter` / `GmoConstants` を `adapter/gmo/` に新設
>   - `PositionSizingService` 新設（`application/`）+ テスト
>   - `main.ts` の DI 書き換え: `latestRate` closure 削除 + `CAPITAL = Number(...)` 廃止 → `Balance.of(Money.jpy(process.env.CAPITAL))` を fallback として DI 注入
>   - 1.7 節の `CAPITAL` バリデーション（`/^\d+$/.test(...)`）はこの PR で導入（Step4 ではまだ `Number(CAPITAL)` のまま）
>   - 上記スコープは細粒度 Step で言うと **Step 3 + Step 4 + Step 5（DI 更新）** に相当
>
> EntryQueue / PositionManager / DB migration / TradingSession dispatch（細粒度 Step 6〜12）は本書では設計記述のみ保持し、それぞれ別 PR で扱う。

#### Step 0（前提）: issue #131 完了 ✅（PR #137 にてクローズ）

- `quote(pair)` / `pipUnit(pair)` / `base(pair)` を `domain/market/CurrencyPair.ts` に追加（module-level 関数。branded string 継続採用）
- `Currency` 型 union（11 通貨）を `domain/market/Currency.ts` に新設し、テンプレートリテラル型 `${Currency}_${Currency}` で `BUSINESS_PAIRS` の型整合を担保
- `pipUnit(pair): Big` は設計憲法 6.1 に従う
- 旧ヘルパ `isJpyQuote(pair)` / `resolvePipUnit(pair)` には `@deprecated` を付与。新規利用は `quote(pair) === 'JPY'` / `pipUnit(pair)` を使う。既存利用箇所の置換と削除は本書 4.3 末尾「Step 11: 旧ヘルパ削除」で実施

#### Step 1: 値オブジェクト整備（domain 層の土台）

ファイル:

- `src/domain/Money.ts`
- `src/domain/Balance.ts`
- `src/domain/Ratio.ts`（`Ratio.EPSILON` / `addUnchecked` 含む）
- `src/domain/market/Rate.ts`
- `src/domain/position/MaintenanceRatio.ts`
- `src/domain/position/MarginRate.ts`（`gmoFxRetail()` は作らない / H9）
- `src/domain/position/LotDecisionInput.ts`（5 引数版 / N-H3）
- `src/domain/position/TotalUnits.ts`（N-C2）
- `src/domain/allocation/StrategyLots.ts`（C3）
- `src/domain/allocation/LotAllocation.ts`（`suppressed()` ファクトリ含む / C4）
- `src/domain/allocation/AllocationContext.ts`（M6）
- `src/domain/allocation/AllocationPolicy.ts`（interface）
- `src/domain/allocation/EqualWeightAllocationPolicy.ts`（残余寄せ実装 / N-H5）

それぞれの VO 定義は `docs/design/value-objects.md` に記載済み。各 VO で境界値・例外・等価性・不変性のテストを書く（設計憲法 6.4）。

`src/adapter/gmo/GmoConstants.ts`（`MARGIN_RATE = MarginRate.of('0.04')`）は本 Step ではなく **Step 5（PositionSizingService 新設フェーズ）で adapter 層に追加** する。Step 1 は domain 層の土台のみで完結させ、adapter 層の業者依存値は後段に分離する。

この Step は**独立してマージ可能**（既存コードに影響しない）。

#### Step 2: LotPolicy interface の変更 + MaintenanceRatioBasedLotPolicy

```ts
// src/domain/position/LotPolicy.ts（書き換え）
export interface LotPolicy {
  decide(input: LotDecisionInput): Lot;
}
```

- `calculateLot(pair, slPips)` を **削除** し、`decide(input)` に統一（`slPips` 削除の影響は既存 `FixedRatioLotPolicy` / `RiskBasedLotPolicy` / `SmaCrossEntryRule` / Rule 呼び出し元。Step 5 で一括対応 / 見落とし 6）
- `MarginBasedLotPolicy.ts` を `MaintenanceRatioBasedLotPolicy.ts` にリネームし、実装を書き換え

書き換え後の骨子（Big 徹底版 / C4 対応）:

```ts
import Big from 'big.js';
import { LotPolicy } from './LotPolicy.js';
import { LotDecisionInput } from './LotDecisionInput.js';
import { Lot } from './Lot.js';
import { quote } from '../market/CurrencyPair.js';

export class MaintenanceRatioBasedLotPolicy implements LotPolicy {
  /** 単一ポジションの Lot 値域（Lot.of と同じ）。設計憲法 6.1: Big 比較で閉じる。 */
  private static readonly MIN = new Big(100);
  /** Lot 上限は Lot 側の public 静的定数を参照（マジックナンバーを policy に持ち込まない）。 */
  private static readonly MAX = new Big(Lot.SINGLE_LOT_MAX_UNITS);

  decide(input: LotDecisionInput): Lot {
    // issue #131 前提: quote(pair) で JPY quote を判定（ドメインの語彙。CurrencyPair は branded string のため module-level 関数で公開）
    if (quote(input.pair()) !== 'JPY') {
      throw new Error(`JPY quote ペア専用: ${String(input.pair())}`);
    }
    // 憲法 6.1: 経路は全て Big。toNumber() は最後 Lot.of に渡す直前まで使わない
    const capital = input.balance().toMoney().toBig();
    const rate = input.rate().toBig();
    const target = input.target().toBig();
    const marginRate = input.marginRate().toBig();

    // Lot = floor(capital / (target × rate × marginRate) / 100) × 100
    const raw = capital.div(target.times(rate).times(marginRate));
    const rounded = raw.div(100).round(0, Big.roundDown).times(100);
    // クランプは Big 同士の比較で閉じる（憲法 6.1: .toNumber() で比較しない）
    // rounded < MIN なら MIN に吊り上げ、rounded > MAX なら MAX に切り下げ
    const min = MaintenanceRatioBasedLotPolicy.MIN;
    const max = MaintenanceRatioBasedLotPolicy.MAX;
    const clamped = rounded.lt(min) ? min : rounded.gt(max) ? max : rounded;
    // number への落ち込みは Lot.of 境界のみ
    return Lot.of(clamped.toNumber());
  }
}
```

**下限クランプ方針（C-4）**:

- `raw < 100`（残高極小）の場合、`MIN = Big(100)` に吊り上げて発注する設計。
- ただし `AllocationPolicy` 側で事前に `Ratio.zero()` 抑制された戦略は `LotAllocation.apply()` から除外されるため、`decide` までは到達しない。
- どちらの抑制が優先かは、PositionManager の処理順（先に AllocationPolicy で抑制、抑制されない戦略のみ decide）で決まる。

この Step で既存 `FixedRatioLotPolicy` / `RiskBasedLotPolicy` / `main.ts` がビルドエラーになる。**同一コミットで**直す。

**Step 2 完了条件（NL-3 / NM-1）**:

- 実装ファイルのリネーム（`MarginBasedLotPolicy.ts` → `MaintenanceRatioBasedLotPolicy.ts`）
- **テストファイルも同時 rename**（`MarginBasedLotPolicy.test.ts` → `MaintenanceRatioBasedLotPolicy.test.ts`）。Step 9（DI 配線）は範囲外として分離。

#### Step 3: BalancePort + RatePort + GmoBalanceAdapter

- `src/port/BalancePort.ts`
- `src/port/RatePort.ts`
- `src/port/Clock.ts`
- `src/infrastructure/time/SystemClock.ts`
- `src/adapter/gmo/GmoBalanceAdapter.ts`

`GmoBalanceAdapter` の内部で 5 秒 TTL のキャッシュを実装。`docs/design/sequence/adapter/gmo-account-assets.md` のシーケンスに従う。

`RatePort` 実装の置き場は brief 改訂候補 P6。`MarketDataStream` が最新 tick を保持しているので、interface に `currentRateOf(pair): Rate` / `currentRateFresh(pair): Rate` を生やして流すのが最短（既存 `MarketDataStream` interface への追加は破壊的なので見落とし 5 参照）。

#### Step 4: PositionSizingService

- `src/application/PositionSizingService.ts`
- `src/application/PositionSizingService.test.ts`

fake 注入で単体テスト（1.10 節）。

#### Step 5: Rule / main.ts の DI 更新

- `main.ts` の DI を 1.7 節の形に書き換え
- `latestRate` closure 変数を削除（`MarketDataStream` 側で `Rate` として保持）
- `SmaCrossEntryRule` 等の既存 Rule が `() => lotPolicy.calculateLot(PAIR, SL)` を受け取っているなら、`() => sizingService.execute(PAIR)` に差し替える
- 将来的には「Rule は Lot を決めない」設計へ（brief 改訂候補 P8）

### 1.9 既存 Rule との配線変更

現状 `main.ts` L142:

```ts
const baseEntryRule = new SmaCrossEntryRule(TRADE_TIMEFRAME, () => lotPolicy.calculateLot(PAIR, STOP_LOSS_PIPS));
```

Rule 側が `() => Lot` を受け取るパターンを維持する場合:

```ts
const baseEntryRule = new SmaCrossEntryRule(TRADE_TIMEFRAME, () => sizingService.execute(PAIR));
```

brief 5.1 / multi-strategy-entry.md の移行先は「**Rule は Lot を決めない**、PositionManager が決める」設計。本 policies.md のスコープ外だが、Step 5 の影響範囲として明示（brief 改訂候補 P8）。

### 1.10 テスト観点

#### 1.10.1 `MaintenanceRatioBasedLotPolicy.decide` 単体テスト（Big 徹底）

純粋関数なので、`LotDecisionInput` を組み立てて期待する `Lot` を検証する。テスト入力は VO 経由で構築する（Big 直書き禁止 / 憲法 6.1）:

```ts
// 「基本」ケースの VO 構築例（他ケースも同形で balance 値だけ差し替える）
const input = LotDecisionInput.of(
  CurrencyPair('USD_JPY'),
  Balance.of(Money.jpy('100000')),
  Rate.of('150', CurrencyPair('USD_JPY'), new Date()),
  MaintenanceRatio.of('1.4'),
  MarginRate.of('0.04'),
);
expect(policy.decide(input)).toEqual(Lot.of(11900));
```

下表の「Input（VO）」列は VO 構築値、「内部 Big 手順」列は実装内部の検算根拠（テストアサーションには使わない）:

| ケース | Input（VO） | 内部 Big 手順（検算用） | 期待値 |
|---|---|---|---|
| 基本（中規模残高） | `Balance=Money.jpy('100000')`, `Rate.of('150', USD_JPY, now)`, `MaintenanceRatio.of('1.4')`, `MarginRate.of('0.04')` | `raw = 100000 / (1.4·150·0.04) ≈ 11904.7619...` → `rounded = floor(raw/100)·100 = 11900` | `Lot.of(11900)` |
| 下限クランプ閾値直上（クランプ不発動） | `Balance=Money.jpy('10000')`, ほか同値 | `raw ≈ 1190.47...` → `rounded = 1100` → `MIN=100` 以上なので clamp 不発動 | `Lot.of(1100)` |
| 下限クランプ発動（残高極小） | `Balance=Money.jpy('100')`, ほか同値 | `raw ≈ 11.9` → `rounded = 0` → `MIN=100` で clamp | `Lot.of(100)` |
| 上限クランプ発動（残高巨大） | `Balance=Money.jpy('10000000000')`, ほか同値 | `raw ≈ 1190476190` → `rounded = 1190476100` → `MAX=Lot.SINGLE_LOT_MAX_UNITS=500000` で clamp | `Lot.of(500000)` |
| 非 JPY quote | `pair=EUR_USD` | throw（`quote(pair) !== 'JPY'`） |
| Ratio.EPSILON 境界 | `target=MaintenanceRatio.of('1.0000000001')` の直上（`target.gt(1)` 境界） | `LotDecisionInput.of` は通る。`MaintenanceRatio.of(1.0)` は throw |
| 既存 `MarginBasedLotPolicy.test.ts` のケース移植 | — | 回帰テストとして残す |

#### 1.10.2 `PositionSizingService.execute` 単体テスト

fake を注入する:

```ts
const fakeBalancePort: BalancePort = {
  current: () => Balance.of(Money.jpy('100000')),
  freshNow: () => Promise.resolve(Balance.of(Money.jpy('100000'))),
};
const fakeRatePort: RatePort = {
  currentOf: () => Rate.of('150', CurrencyPair('USD_JPY'), new Date()),
  currentFresh: () => Rate.of('150', CurrencyPair('USD_JPY'), new Date()),
};
const fakeLotPolicy: LotPolicy = { decide: () => Lot.of(1100) };
const service = new PositionSizingService(
  fakeBalancePort, fakeRatePort, fakeLotPolicy,
  Balance.of(Money.jpy('50000')),
  MaintenanceRatio.of('1.4'),
  MarginRate.of('0.04'),  // テストでは直接生成。本番は GmoConstants.MARGIN_RATE
);
expect(service.execute(CurrencyPair('USD_JPY'))).toEqual(Lot.of(1100));
```

| ケース | 設定 | 期待挙動 |
|---|---|---|
| 通常: `current()` 成功 | `current() = Balance(100_000)` | fallback 使わず Balance(100_000) を LotPolicy に渡す |
| フォールバック: `current()` が null | `current() = null` | fallback(50_000) を LotPolicy に渡す |
| `currentOf` 例外 | `currentOf() throws` | `execute()` が throw をそのまま伝播 |
| `executeWithFresh(): freshNow()` 成功 | `freshNow() = Balance(200_000)` | fallback 使わず |
| `executeWithFresh(): freshNow()` throw | `freshNow() throws` | `executeWithFresh()` が throw を伝播（fallback しない） |

#### 1.10.3 `GmoBalanceAdapter` 結合テスト

- 5 秒 TTL の挙動（`Clock` fake で時刻固定）
- `current()` の API エラー時 null 返却
- `freshNow()` の API エラー時 throw
- 既存 `docs/design/sequence/adapter/gmo-account-assets.md` のフローをなぞる

> **責務の境界（CAPITAL フォールバック非保持）**:
>
> - **`GmoBalanceAdapter` 自身は CAPITAL フォールバックを持たない**。Adapter 層に環境変数依存を持ち込まないため
> - API 失敗時 `current()` は **null を返す**（呼び出し側が `?? fallbackBalance` で吸収）
> - API 失敗時 `freshNow()` は **throw する**（発注直前の鮮度保証経路。フォールバックしない）
> - **CAPITAL フォールバックは `main.ts` で `Balance.of(Money.jpy(...))` に値オブジェクト化し、`PositionSizingService` のコンストラクタに `fallbackBalance` として注入する**（1.7 節と整合）
> - 結合テストでは Adapter が「null 返却」「throw」のいずれかに正しく振る舞うことのみ検証し、CAPITAL 由来の Balance を返さないことを確認する

### 1.11 合計ロット上限チェック（H2）

`PositionSizingService` は単一戦略の基準 Lot のみ返す。`StrategyLots` 組み立て後の**合計ロット上限チェックは `PositionManager` の責務**。

```ts
// PositionManager.handleSignals 内
const strategyLots = allocation.apply(baseLot);
if (strategyLots.totalLot().isExceedingSingleLotLimit()) {
  // 合計が単一 Lot 上限（500,000）を超えた → 全件 drop + warn
  this.logger.warn('strategyLots total exceeds single lot limit, drop all', {
    total: strategyLots.totalLot().toString(),
    strategies: strategyLots.strategies().map((s) => s.value),
  });
  return;  // EntryQueue に何も流さない
}
```

**方針**:

- `totalLot(): TotalUnits` の結果が `isExceedingSingleLotLimit()` の場合、**全件 drop + `LogPort.warn(...)`**（部分絞り込みはしない。早計な自動スケールダウンは Allocation 層の責務に戻す / 4.1 節）
- 実運用で合計ロット上限超過が頻発するなら、`AllocationPolicy` 側で事前にスケールダウンする（`EqualWeightAllocationPolicy` の責務）
- **M11 / H-2**: `TotalUnits` は内部で 500_000 を保持。**外部参照は `isExceedingSingleLotLimit()` API のみ使う**（`SINGLE_LOT_MAX` 等の生定数を `PositionManager` 側で直接参照しない）

**テスト観点（NM-2）**:

- `strategyLots.totalLot().isExceedingSingleLotLimit()` が true の時、(a) `EntryQueue` に enqueue されない、(b) `LogPort.warn(...)` が発火する 2 点を単体テストで検証（4.1 節）
- 境界値: 合計 500_000 ぴったり（境界、enqueue 可）/ 500_001（超過、drop）

---

## 2. 複数ポジション制約（brief 5.4）

### 2.1 方針の再確認

- **`position_id`（`positions.id`）単独主キー**（現状維持）
- `(currency_pair, strategy_name)` の **OPEN 状態部分ユニーク制約**を追加
- 同一 pair + 同一 strategy で CLOSED は何本あってもよい
- GMO の両建て設定（`isHedgeable: true`）は直交する論点で従来通り

### 2.2 制約の SQL

Postgres の部分ユニークインデックスを使う。

```sql
CREATE UNIQUE INDEX idx_positions_open_unique
  ON positions (currency_pair, strategy_name)
  WHERE status = 'OPEN';
```

**ポイント**:

- カラム名は既存スキーマに合わせ `currency_pair`
- `WHERE status = 'OPEN'` で **CLOSED は対象外**（複数本 OK）
- PostgreSQL の ENUM `position_status` に対する比較は文字列リテラルでよい
- 将来 PENDING 状態を導入する場合（brief 改訂候補 P9）は `WHERE status IN ('OPEN', 'PENDING')` に差し替え
- **見落とし 4（`strategy_name` カラム長 defensive）**: DB の `strategy_name` カラムは `varchar(32)` 以上あること。`StrategyNameValue` の最大長（例: `'WICK_REVERSAL'` = 13）を踏まえ、スキーマで 32 文字を確保し、`CHECK (strategy_name IN ('SMA_CROSS', 'RSI_REVERSAL', 'SMA_DISTANCE', 'WICK_REVERSAL'))` も入れる（アプリ層の enum とスキーマ層の defensive 制約の二重防御）

### 2.3 Drizzle マイグレーション

現状の drizzle マイグレーション:

- `0000_aberrant_union_jack.sql`: 初期テーブル
- `0001_unique_christian_walker.sql`: `strategy_name` 等のカラム追加（デフォルト `'SMA_CROSS'`）

追加する `0002` は手動で SQL を書く必要がある可能性が高い。

#### パターン A: Drizzle スキーマで宣言

```ts
// src/infrastructure/database/schema/positions.ts
import { pgTable, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const positions = pgTable('positions', {
  /* 既存カラム */
}, (table) => ({
  openUnique: uniqueIndex('idx_positions_open_unique')
    .on(table.currencyPair, table.strategyName)
    .where(sql`${table.status} = 'OPEN'`),
}));
```

#### パターン B: 手書き migration

drizzle-kit が部分インデックスを吐かない場合:

```sql
-- drizzle/0002_add_positions_open_unique.sql
CREATE UNIQUE INDEX "idx_positions_open_unique"
  ON "positions" ("currency_pair", "strategy_name")
  WHERE "status" = 'OPEN';
```

journal にも登録が必要（`drizzle/meta/_journal.json`）。

**採用方針**: まずパターン A を試し、drizzle-kit の生成結果を確認。部分インデックスが吐かれなければパターン B に切り替える。

### 2.4 既存データとの整合性

- `strategy_name` カラムのデフォルト値は `'SMA_CROSS'`（0001 migration）
- 既存 OPEN ポジション（常に 0〜1 件想定）は `strategy_name = 'SMA_CROSS'` を持つので衝突なし
- CLOSED ポジションには制約が及ばない

**migration 実行前チェック（defensive / L-6）**:

```sql
SELECT currency_pair, strategy_name, COUNT(*)
  FROM positions
  WHERE status = 'OPEN'
  GROUP BY currency_pair, strategy_name
  HAVING COUNT(*) > 1;
```

結果が 0 行であることを migration PR の本文で明示する。`psql` / `drizzle-kit studio` 等の実行手順は PR 説明文にコマンドラインごと貼る（運用手順の再現性）。

### 2.5 ExitRule 評価ループの変更

#### 現状: 全 OPEN × 全 Rule の総当たり

```ts
// 現状のイメージ
for (const position of openPositions) {
  for (const exitRule of this.exitRules) {
    const cmd = exitRule.shouldExit(position, snapshot);
    if (cmd) { /* 決済実行 */ }
  }
}
```

#### 新: `ExitDispatcher` + `ExitRuleRegistry`（PR B 実装）

PR B で `TradingSession` から決済評価責務を `ExitDispatcher`（application 層）に切り出し、戦略 × ExitRule の対応は `ExitRuleRegistry`（domain 層、ファーストクラスコレクション）に閉じ込める。

`ExitRuleRegistry` は 2 つの lookup API を持つ:
- `findRule(strategy): ExitRule | undefined` — Dispatcher の通常経路（Optional 返却）
- `ruleFor(strategy): ExitRule` — 起動時 fail-fast 用（`MissingExitRuleError` throw）

```ts
// application/ExitDispatcher.ts
async dispatch(pair: CurrencyPair, snapshot: MarketSnapshot): Promise<ExitDispatchResult> {
  const ordered = (await this.positionRepository.openPositions())
    .forPair(pair)
    .sortedByOpenedAtAsc();

  // 各 Position をループ:
  //   1. registry.findRule(strategy) → undefined なら warn + skipped(rule_missing)
  //      （fail-fast でなく通常経路の Optional フロー制御）
  //   2. rule.shouldExit → ExitCommand なら extremesPort.find →
  //        undefined → warn + skipped(extremes_unavailable)（次 tick 再評価）
  //        ExtremesSnapshot → closeAndNotify → closed.push + extremesPort.remove
  //   3. closePosition throw → error + failed.push（次 tick で update により極値上書き）
  //   4. notifyExitExecuted throw → error + closed に積む（決済確定済 / 通知失敗のみ）
}
```

DI 側:

```ts
// main.ts（PR C で実施）
const registry = ExitRuleRegistry.of([
  [StrategyName.SMA_CROSS, smaExitRule],
  // ...新戦略はここに追加（OCP）
]);

// 起動時 fail-fast 検証（PR C）:
const held = (await positionRepository.openPositions()).heldStrategyNames();
const registered = registry.registeredStrategies();
const orphaned = [...held].filter((s) => !registered.has(s));
if (orphaned.length > 0) {
  throw new Error(`ExitRuleRegistry に未登録の戦略を保有中: ${JSON.stringify(orphaned)}`);
}

const exitDispatcher = new ExitDispatcher(
  registry,
  positionRepository,
  exitExecution,
  uiNotifier,
  positionExtremesUpdater,  // PositionExtremesPort 実装
  logger,
);
```

**Note（N-C1 / C2）**:

- `ExitRuleRegistry.of` はタプル配列入力。内部で `.value` 同値で重複検知（#130 未完で `StrategyName` の参照同値が壊れているため Map 入力にしない）
- `findRule(strategy): ExitRule | undefined` — Dispatcher 通常経路（フロー制御を例外でなく Optional で表現）
- `ruleFor(strategy): ExitRule` — 起動時 fail-fast 用。未登録時は `MissingExitRuleError.notRegistered(strategy)` を throw（既存 `RatePort.currentFresh` 流の throw 契約）
- `findOpenByPairAndStrategy` の内部実装も `.value` で比較する（#130 完了で `.equals()` に戻す）

**OCP の担保**: 新戦略追加時は `ExitRuleRegistry.of([...])` にエントリを 1 つ足すだけ。

**例外境界 / ログ event 一覧** (詳細は `multi-strategy-exit.md`):

| 状況 | level | event |
|---|---|---|
| `findRule` が undefined（戦略未登録）| warn | `exit_rule_missing` |
| `extremesPort.find` が undefined | warn | `exit_extremes_unavailable` |
| `rule.shouldExit` / `closePosition` throw | error | `exit_dispatch_failed` |
| `notifyExitExecuted` throw | error | `exit_notify_failed` |

### 2.6 PositionRepository の新メソッド

現状の `PositionRepository`:

```ts
export interface PositionRepository {
  register(position: Position, entrySnapshot?: EntrySnapshot): Promise<void>;
  update(position: Position): Promise<void>;
  findById(id: PositionId): Promise<Position>;
  openPositions(): Promise<OpenPositions>;
}
```

#### 追加するメソッド

```ts
export interface PositionRepository {
  // 既存
  register(position: Position, entrySnapshot?: EntrySnapshot): Promise<void>;
  update(position: Position): Promise<void>;
  findById(id: PositionId): Promise<Position>;
  openPositions(): Promise<OpenPositions>;

  // 新規: 事前重複チェック
  findOpenByPairAndStrategy(
    pair: CurrencyPair,
    strategyName: StrategyName,
  ): Promise<Position | null>;

  // 新規（brief 改訂候補 P9、PENDING 正式導入と合わせて）
  // insertPending(pair, strategy, plannedLot, snapshot): Promise<PendingId>;
  // markAborted(pendingId: PendingId): Promise<void>;
}
```

**実装上の N-C1 注意**:

- SQL 内の `strategy_name` カラム比較は **`strategyName.value`**（`StrategyNameValue`）で行う。`strategyName.toString()` に依存しない（N-C1）
- issue #130 完了後に実装を `strategyName.equals(...)` ベースへ戻す Note をコメントに残す（H7）

**`findOpenByPairAndStrategy` の用途**:

- `PositionManager.handleSignals` 内で、Rule 発火時に既存 OPEN の事前チェック
- UNIQUE 違反を DB で弾くだけでなく、**アプリ層で先にわかる**ことで `LogPort.info('duplicate entry suppressed', ...)` を出せる（4.1 節）

### 2.7 エッジケース

#### 2.7.1 同 tick で決済 → 反対エントリー（ドテン）

- ExitRule が tick T0 で ExitCommand → Broker.placeExit → Position.close → DB `status = CLOSED`
- 同 tick T0 の続きで EntryRule が反対方向エントリー
- GMO 側のポジション反映に 100-500ms のラグ → `freshNow()` に直前の証拠金解放が未反映の可能性

**対策**:

- **見落とし 7（`Position.open` と UNIQUE 順序）**: 新規 OPEN の `Position.open()` は、同 pair + 同 strategy の CLOSED 化が DB に反映された後に実行する。UNIQUE 違反を避けるため、トランザクション内で「close 先 → open 後」の順序を守る
- `Broker.syncPositionState()` を明示的に呼んで証拠金解放を取り込む（**M7**: `Broker.syncPositionState` は新規メソッドとして別 PR で追加することを前提）
- 残りの不整合は `pendingMargin = EntryQueue.reservedMargin()` が同 tick 内の反対 enqueue 分を反映することで相殺

#### 2.7.2 トランザクション境界（発注 API → DB register の間）

- `Broker.placeEntry` が成功 → `PositionRepository.register` が失敗（DB 接続断等）
- GMO 側には建玉が発生済み → ゴーストポジション
- 対策は `multi-strategy-entry.md` の補償決済フロー（`placeExit(compensation)` を即実行 + `LogPort.error(...)`。旧 `critical` は `LogPort.error` で記録 + 補償決済を即時起動 / 4.1 節 Note）

UNIQUE 制約との関係は brief 改訂候補 P9。

#### 2.7.3 UNIQUE 制約違反時のエラーハンドリング

```ts
// PostgresPositionRepository.register 内
try {
  await this.db.insert(positions).values(...);
} catch (err) {
  if (isUniqueViolation(err)) {  // Postgres: error code 23505
    throw new DuplicatePositionError(pair, strategyName);
  }
  throw err;
}
```

`DuplicatePositionError` を専用 Error で切り、呼び出し側（`PositionManager` or `EntryExecution`）で `logger.info('duplicate entry suppressed', { pair, strategy })`（4.1 節）。

### 2.8 テスト観点

#### 2.8.1 部分ユニーク制約の結合テスト

docker-compose 等で Postgres を起動し、migration 適用後にテストを走らせる。

| ケース | 手順 | 期待値 |
|---|---|---|
| 同一 pair + 同一 strategy で 2 本目 OPEN | `insert(USD_JPY, SMA_CROSS, OPEN)` × 2 | 2 本目が UNIQUE 違反 |
| 同一 pair + 異なる strategy で 2 本 OPEN | `(USD_JPY, SMA_CROSS)`, `(USD_JPY, RSI_REVERSAL)` | 両方成功 |
| 同一 pair + 同一 strategy で OPEN 1 本 + CLOSED 複数本 | 1 本目 OPEN → close → 2 本目 OPEN | OK |
| 同一 pair + 同一 strategy で CLOSED 複数本 | 全て CLOSED | OK |

#### 2.8.2 `findOpenByPairAndStrategy` の単体テスト

- OPEN が 1 件 → Position を返す
- OPEN が 0 件 → null を返す
- CLOSED のみ → null を返す

#### 2.8.3 ExitRule ディスパッチの単体テスト

`TradingSession.evaluateExit` のテストで:

- Map に登録されていない戦略のポジションが来た時に `LogPort.warn(...)` が呼ばれる（4.1 節）
- 1 戦略が throw しても他戦略の評価は継続される（H12）
- 評価順序が `openedAt` 昇順で決定論的

---

## 3. EntryQueue（brief 5.5）

### 3.1 方針の再確認

- `src/action/EntryQueue.ts` に独立コンポーネントとして実装
- `PositionManager` が DI で利用
- 古シグナル破棄（TTL 3 秒）+ 順序保持（FIFO）に専念
- POST 1 秒 1 件の**実レート制限**は `GmoRestClient.throttlePost` に集約（EntryQueue は守らない）
- 通知は **`LogPort`（運用ログ・構造化ログ）** + **`UiNotifier`（UI 状態通知）** の 2 系統に分離する。`AlertPort` は本書では新設しない（4.1 節）。`LogPort` は `domain/port/LogPort.ts`、`UiNotifier` は `port/UiNotifier.ts` の既存実装を DI で受け取る

### 3.2 データ構造

#### 3.2.1 キュー本体

```ts
type QueuedEntry = {
  command: EntryCommand;
  submittedAt: Date;  // enqueue された時刻（Clock ポート経由）
};

export class EntryQueue implements EntryQueuePort {
  private readonly queue: QueuedEntry[] = [];
  // プラットフォーム非依存に `ReturnType<typeof setInterval>` を使う（NodeJS.Timeout 型直書きを避ける）
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private draining = false;  // C9: drain 再入防止

  constructor(
    // 具象 EntryExecution ではなく、最小ポート EntryExecutor に依存（テスト容易性）
    private readonly entryExecution: EntryExecutor,
    private readonly clock: Clock,
    private readonly logger: LogPort,        // 運用ログ（infrastructure/logging/Logger）
    private readonly uiNotifier: UiNotifier, // UI 状態通知（SocketIoUiNotifier）
    options: EntryQueueOptions = {},         // ttlMs / drainIntervalMs（main.ts で明示注入）
  ) { /* options 展開 */ }
  // ...
}
```

> **配置（実装と同期）**:
> - `EntryQueuePort` interface: `packages/backend/src/port/EntryQueuePort.ts`（Port 層）
> - `EntryExecutor` interface: `packages/backend/src/action/EntryExecutor.ts`（EntryQueue が依存する最小ポート。`EntryExecution` が implement する）
> - `EntryQueue` 具象クラス: `packages/backend/src/action/EntryQueue.ts`

- 内部は単純な配列 + `push` / `shift` で FIFO
- Node.js single-thread 前提だが、`drain` は `await` を含むので再入可能性あり → `draining` フラグで排他（C9）

### 3.3 API シグネチャ

`EntryQueuePort` は **`packages/backend/src/port/EntryQueuePort.ts`** に分離する（Port 層 / Clean Architecture オニオン構造）。具象 `EntryQueue` は `packages/backend/src/action/EntryQueue.ts` で `implements EntryQueuePort`。

```ts
// packages/backend/src/port/EntryQueuePort.ts
export interface EntryQueuePort {
  start(): void;
  stop(): Promise<void>;
  enqueue(command: EntryCommand, submittedAt: Date): void;
  /** drain タイマーから呼ばれる */
  drain(): Promise<void>;
  /** 未発注シグナルの合計証拠金見込み */
  reservedMargin(): Money;
  /** 通常運用での残留 drain（shutdown 時は呼ばない / NL-2） */
  drainAndWait(): Promise<void>;
  /** shutdown 専用: 残留分を発注せず全件 drop（NL-2 / P12 確定） */
  dropAllAtShutdown(): Promise<void>;
}
```

#### 3.3.1 `reservedMargin()` のシグネチャ確定（C8）

**確定方針（P10 を本 PR で確定採用）**:

- `EntryCommand` に**生成時に事前計算した** `requiredMargin(): Money` を保持させる
- レート取得責務は **`PositionManager` / `PositionSizingService` 側**が担い、`EntryCommand` にレートを要求しない
- `EntryQueue.reservedMargin()` は **保持済みの `requiredMargin()` を合算するだけ**の純関数

```ts
// EntryCommand 側（生成時に requiredMargin を埋める）
// 計算は domain/position/RequiredMarginCalculator.ts の `requiredMarginAsJpy()` に集約済み。
// 通常は `PositionSizingService.executeSizing(pair)` が返す `SizingResult` の
// `requiredMargin()` をそのまま流用する（NH-2: rate 二重取得回避）。
const sizing = positionSizingService.executeSizing(pair);  // SizingResult
const command = EntryCommand.of({
  pair, buySell,
  lot: sizing.lot(),
  strategyName, entrySnapshot, reason, convictionScore,
  requiredMargin: sizing.requiredMargin(),  // 既に JPY 整数化済み（Big 最終段で toFixed(0)）
});

// EntryQueue 側
reservedMargin(): Money {
  return this.queue.reduce(
    (acc, q) => acc.plus(q.command.requiredMargin),  // EntryCommand のフィールド（メソッドではない）
    Money.jpy('0'),
  );
}
```

これにより:

- `EntryQueue` はレート / `MarginRate` を知らない（責務境界明確化）
- `reservedMargin()` の戻り値が常に一致（同じ enqueue 後に 2 回呼んで値が変わらない）

#### 3.3.2 各メソッドの挙動

**`start()`**:

```ts
start(): void {
  if (this.intervalHandle) return;  // 冪等
  this.intervalHandle = setInterval(() => {
    this.drain().catch((err) => this.logger.error('drain エラー', { error: String(err) }));
  }, this.drainIntervalMs);
  this.intervalHandle.unref();  // H8: Node.js 依存。プロセス終了を妨げない
}
```

> **Note (H8 Node 依存)**: `setInterval().unref()` は Node.js 固有 API（ブラウザに存在しない）。本プロジェクトは backend 専用なので使用可。テスト環境（Vitest）でも Node で動くので問題ない。

**`stop()`**:

```ts
async stop(): Promise<void> {
  this.stopped = true;
  if (this.intervalHandle) {
    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }
  await this.dropAllAtShutdown();  // NL-2: shutdown 時は残留分を発注せず全件 drop（P12 確定）
}
```

**`enqueue()`**:

```ts
enqueue(command: EntryCommand, submittedAt: Date): void {
  if (this.stopped) {
    this.logger.info('enqueue ignored after stop');
    return;
  }
  this.queue.push({ command, submittedAt });
}
```

**`drain()`**:

```ts
async drain(): Promise<void> {
  // C9: 並列 drain 呼び出し防止
  if (this.draining) return;
  if (this.queue.length === 0) return;
  this.draining = true;
  try {
    const head = this.queue.shift();
    if (!head) return;

    const now = this.clock.now();
    const age = now.getTime() - head.submittedAt.getTime();
    if (age > this.ttlMs) {
      this.logger.warn('signal dropped due to TTL', {
        age,
        ttl: this.ttlMs,
        strategy: head.command.strategyName.value,  // N-C1
        pair: head.command.pair.toString(),
      });
      // UI のシグナル表示も消す（責務直交: 運用ログ + UI 状態通知）
      await this.uiNotifier.notifyEntryExpired(head.command);
      return;
    }
    try {
      await this.entryExecution.openPosition(head.command);
      this.logger.info('entry placed', {
        strategy: head.command.strategyName.value,
        pair: head.command.pair.toString(),
      });
    } catch (err) {
      this.logger.warn('placeEntry failed - signal dropped', {
        error: String(err),
        strategy: head.command.strategyName.value,
      });
      await this.uiNotifier.notifyEntryExpired(head.command);
      // drop（再投入しない）
    }
  } finally {
    this.draining = false;
  }
}
```

**`drainAndWait()`**:

```ts
async drainAndWait(): Promise<void> {
  while (this.queue.length > 0) {
    await this.drain();
  }
}
```

### 3.4 スロットリングの責務分担

| コンポーネント | 責務 |
|---|---|
| `EntryQueue` | 順序保持 + TTL 破棄 + 排他 drain |
| `GmoRestClient.throttlePost` | 1 秒 1 件の実レート制限 |

> **Note (NH-1 / P13 整合済み)**:
> - brief 5.5 R1（確定 2026-04-23）で本書 3.4 と同じ責務分担に整合済み: 「`EntryQueue` は順序保持 + TTL 破棄 + 排他 drain、POST 1 秒 1 件の実レート制限は `GmoRestClient.throttlePost`（既存実装）に集約」。
> - 受入基準（brief.md 3 章）も同方針で記述済み。
> - **`GmoRestClient.throttlePost` は既存実装あり**（`packages/backend/src/adapter/gmo/GmoRestClient.ts:175`、`doPost` 内 line 89 で呼ばれている）。EntryQueue 側で 1 秒制限を守る必要はない。実装追加は不要。
> - 旧 P13「brief 5.5 文書改訂」は本 PR で吸収済み。

**drain 間隔の根拠（M3）**:

- 既定 100ms。TTL 3000ms に対して 1/30 の粒度があれば「drain 待ちで TTL 超過」が起きにくい
- 1 秒にすると「TTL 3 秒」と重なり 3 本目が TTL 間際になる
- 100ms は `setInterval` のオーバーヘッドとして無視できる（0.1% 程度）
- 実 POST 発火は `throttlePost` が 1 秒制限で整流するので、drain 頻度を上げても POST は増えない

### 3.5 古シグナル破棄の判定タイミング

#### なぜ enqueue 時ではなく drain 時か

- enqueue 時の `age` はほぼ 0（PM が `clock.now()` で生成した `submittedAt` を即渡すため）
- enqueue 時に「古い submittedAt」を弾くと FIFO の期待動作が崩れる
- drain 時判定なら、先頭が古ければ drop、次以降は**次の drain tick** で評価されより新しい可能性

#### LogPort + UiNotifier 通知

TTL 破棄は `LogPort.warn` で運用ログに記録（4.1 節 ログレベル表参照。設計の防御発動）し、合わせて `UiNotifier.notifyEntryExpired(command)` で UI 表示を消す。

**TTL 値の外出し**:

- `ttlMs` はコンストラクタ引数 `{ ttlMs: number = 3000 }` で注入可能に
- 環境変数化は brief 改訂候補 P11

### 3.6 タイマーライフサイクル

#### `setInterval` の `unref()`

```ts
this.intervalHandle = setInterval(..., this.drainIntervalMs);
this.intervalHandle.unref();
```

- Node.js 依存（H8）。プロセス終了を妨げない
- テスト終了時の hang も防げる

#### TradingSession からの呼び出し

```ts
// TradingSession.start
this.entryQueue.start();

// TradingSession.stop
await this.entryQueue.stop();
```

#### shutdown 時の残留分方針（H9 / P12 → 確定）

**確定方針（本 PR）**: shutdown 時は **EntryQueue の残留分を即破棄**、各 drop に `LogPort.info(...)` で運用ログを出力し、`UiNotifier.notifyEntryExpired(command)` で UI 側のシグナル表示も消す。理由:

- shutdown は「停止する」という運用判断の局面であり、新規エントリーを送り増やすべきでない
- 残留発注を続けると、停止直前に意図しない建玉が増え、運用者の停止意図と矛盾する
- 「1 秒 1 件で最大 N 秒」の shutdown 遅延より、即時 shutdown 優先

> **更新（#221）**: かつての根拠「shutdown = 強制決済を伴う」は撤廃済み。shutdown 時に OPEN ポジションを成行決済する仕様は廃止し、ポジションは GMO 側に保持され、次回起動時に ExitDispatcher が DB の OPEN を継承して監視を再開する。EntryQueue 残留分を破棄する方針自体は上記理由により維持する。

```ts
async stop(): Promise<void> {
  this.stopped = true;
  if (this.intervalHandle) {
    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }
  await this.dropAllAtShutdown();
}

async dropAllAtShutdown(): Promise<void> {
  // 残留分を全部 drop（P12 確定: 発注しない / NL-2）
  while (this.queue.length > 0) {
    const dropped = this.queue.shift();
    if (!dropped) break;
    this.logger.info('entry dropped at shutdown', {
      strategy: dropped.command.strategyName.value,
      pair: dropped.command.pair.toString(),
    });
    await this.uiNotifier.notifyEntryExpired(dropped.command);
  }
}
```

> **Note (NL-2 命名確定)**: shutdown 時は残留分を発注せず即破棄するため、命名を **`dropAllAtShutdown`** に統一する（drain しないので `drainAndWaitForShutdown` ではなく直接的な命名）。`drainAndWait()` は通常運用時の純粋な「残留 drain」用途のみで保持し、shutdown 時には呼ばない。

### 3.7 Clock 注入

#### ポート定義

```ts
// src/port/Clock.ts（L-4: VO ではなく port として配置）
export interface Clock {
  now(): Date;
}

// src/infrastructure/time/SystemClock.ts
export class SystemClock implements Clock {
  now(): Date { return new Date(); }
}
```

> **Note (L-4)**: `Clock` は「時刻取得の抽象」であり値オブジェクトではない（time をソースに持つ依存）。port 層に置く。`SystemClock` は infrastructure に。

#### テスト用 FakeClock

```ts
export class FakeClock implements Clock {
  private current: Date;
  constructor(initial: Date) { this.current = initial; }
  now(): Date { return new Date(this.current.getTime()); }  // 防御的コピー
  advance(millis: number): void {
    this.current = new Date(this.current.getTime() + millis);
  }
}
```

`Date.now()` / `new Date()` を直書きせず、必ず `Clock` 経由で取得する。

### 3.8 失敗時の挙動

#### 3.8.1 `EntryExecution.openPosition` が throw

**方針: drop**（再投入しない）。`multi-strategy-entry.md` の Note に従う。

- `LogPort.warn` で API 失敗を運用ログに記録 + `UiNotifier.notifyEntryExpired(command)` で UI 側のシグナル表示を消す
- 再投入すると TTL まで重複注文リスク

#### 3.8.2 shutdown 中の drain

`stop()` 後は `enqueue` を無効化（`stopped` フラグで拒否）。

### 3.9 PositionManager からの利用イメージ

```ts
// PositionManager.handleSignals 末尾付近
// NH-2: PositionSizingService.executeWithFresh で取得した SizingResult を流用し、
// PositionManager 側で RatePort.currentFresh を再度呼ばない（レート二重取得回避）。
const result = await sizingService.executeWithFresh(pair);  // Promise<SizingResult>
const baseLot = result.lot();
const rate = result.rate();
const baseRequiredMargin = result.requiredMargin();  // baseLot に対応する requiredMargin

const strategyLots = allocation.apply(baseLot);
if (strategyLots.totalLot().isExceedingSingleLotLimit()) { /* 1.11 節の drop */ return; }

for (const strategy of strategyLots.strategies()) {
  const lot = strategyLots.lotOf(strategy);
  if (lot === null) continue;  // 念のため（apply() が Ratio.zero() を除外しているので通常発生しない）
  // strategy 別の Lot に対する requiredMargin を SizingResult.rate から再計算（rate は 1 回取得を流用）。
  const requiredMargin = Money.jpy(
    Number(rate.toBig().times(new Big(lot.toNumber())).times(this.marginRate.toBig()).toFixed(0)),
    // 注: Lot は整数 VO（100〜500_000）のため toNumber() 経由を許容（憲法 6.1 例外）。
    // 将来 value-objects.md に Lot.toBig() を追加すれば憲法 6.1 完全遵守となる（改訂候補）。
  );
  const command = EntryCommand.of({
    pair, buySell: signal.buySell, lot, strategyName: strategy, entrySnapshot: signal.snapshot,
    reason: signal.reason, convictionScore: signal.convictionScore, requiredMargin,
  });
  this.entryQueue.enqueue(command, this.clock.now());  // C8: requiredMargin を埋めた Command を即 enqueue
}
```

PositionManager は「enqueue するだけ」で完結。POST の間隔調整や TTL 判定は EntryQueue 任せ。

### 3.10 テスト観点

#### 3.10.1 TTL 判定（FakeClock）

```ts
const clock = new FakeClock(new Date('2026-04-22T12:00:00Z'));
const queue = new EntryQueue({ ttlMs: 3000, drainIntervalMs: 100, clock, ... });

// T=0
queue.enqueue(cmd1, clock.now());
// T=2.9s → TTL 内
clock.advance(2900);
await queue.drain();
expect(entryExecution.openPosition).toHaveBeenCalledWith(cmd1);

// 別コマンドを T=0 で enqueue して T=3.1s で drain
queue.enqueue(cmd2, new Date('2026-04-22T12:00:00Z'));
clock.advance(200);
await queue.drain();
expect(entryExecution.openPosition).not.toHaveBeenCalledWith(cmd2);
expect(logger.warn).toHaveBeenCalledWith('signal dropped due to TTL', expect.any(Object));
expect(uiNotifier.notifyEntryExpired).toHaveBeenCalledWith(cmd2);
```

#### 3.10.2 FIFO 順序

```ts
queue.enqueue(cmdA, clock.now());
clock.advance(10);
queue.enqueue(cmdB, clock.now());
await queue.drain(); await queue.drain();
expect(entryExecution.openPosition).toHaveBeenNthCalledWith(1, cmdA);
expect(entryExecution.openPosition).toHaveBeenNthCalledWith(2, cmdB);
```

**見落とし 9（ms 同値順序）**: `Date.getTime()` が同値になる高速 enqueue では、`queue.push` の**挿入順**が FIFO を保証する。`sort` は一切しない（タイブレークは配列の push 順）。

#### 3.10.3 複数戦略同時 enqueue の処理順序（C9 並列 drain）

- 4 戦略同時検知 → PM が 4 コマンド連続 enqueue
- テストで `drain()` を **並列に 2 回呼んで**、`draining` フラグで 1 本だけが進み、もう 1 本は即 return することを検証
- 4 本目が TTL 境界に引っかかる懸念は brief 改訂候補（Rule 別 TTL / 優先度）

#### 3.10.4 start / stop ライフサイクル

- `start()` 2 回呼んでも idempotent
- `stop()` 後に `enqueue` しても無視される（`logger.info('enqueue ignored after stop')`）
- `stop()` で残留分が全件 drop される（P12 確定。各 drop で `logger.info` + `uiNotifier.notifyEntryExpired` が呼ばれる）

#### 3.10.5 エラーハンドリング

- `EntryExecution.openPosition` が throw → drop + `logger.warn('placeEntry failed - signal dropped', ...)` + `uiNotifier.notifyEntryExpired(command)`
- 再投入されないこと

#### 3.10.6 `reservedMargin()` の境界値

- 空キュー → `Money.jpy('0')`
- 1 件 enqueue → その `requiredMargin()` と一致
- 複数件 → `Money.jpy('0').plus(...).plus(...)` と一致（順序非依存）

---

## 4. 横断事項

### 4.1 LogPort + UiNotifier の使い分け（H10 改訂 / 旧 AlertPort 統一表）

**方針確定（本 PR）**: 旧 H10 では `AlertPort` を新設してログレベル別通知を一元化する案だったが、本書では既存実装に合わせ **`LogPort`（運用ログ）** + **`UiNotifier`（UI 状態通知）** の 2 系統を併用する方式に変更する。`AlertPort` は新設しない。Slack / Discord / Webhook 等の外部通知が必要になった時点で `LogPort` の adapter（`infrastructure/logging/Logger.ts`）から経路を増やすか、独立 Port として再導入を検討する（4.4 brief 改訂候補）。

**棲み分け（NH-3 改訂）**:

- `UiNotifier`（既存、`packages/backend/src/port/UiNotifier.ts`）はシグナル状態の UI 表示用。
  - `notifyEntryReady(command: EntryCommand): Promise<void>` — エントリー準備が整ったとき
  - `notifyEntryExpired(command: EntryCommand): Promise<void>` — エントリーが期限切れ/失敗で消えるとき（TTL 破棄、API 失敗による drop、shutdown 時 drop）
  - `notifyExitExecuted(command: ExitCommand): Promise<void>` — 決済が実行されたとき
  - 実装は WebSocket 経由でフロントエンドへ送信。発注制御ではない（MEMORY.md 参照）。
- `LogPort`（既存、`packages/backend/src/domain/port/LogPort.ts`）は構造化された運用ログ用。
  - `debug(message, data?)` / `info(message, data?)` / `warn(message, data?)` / `error(message, data?)` の 4 メソッド
  - 本番実装は `infrastructure/logging/Logger.ts`、テスト用は `domain/port/NoopLogPort.ts`
  - ドメイン層が直接 `infrastructure/logging/Logger` を参照しないよう DI で注入する（DDD レイヤ保護）
- 両者は責務が直交するので **EntryQueue 等は両方を DI で受け取り、用途に応じて使い分ける**（運用ログ = `LogPort`、UI 状態の整合 = `UiNotifier`）。

**ログレベルの使い分け（旧 H10 表の再整理）**:

| level | 意味 | 代表ケース | 通知先 |
|---|---|---|---|
| `LogPort.error` | 自動回復不可だが致命ではない | `ExitRule` 評価の throw（H12）。`placeExit` リトライ 3 回失敗（multi-strategy-exit.md）。DB 接続断 | `LogPort.error(...)` |
| `LogPort.warn` | 設計通りの防御発動 | EntryQueue の TTL 破棄。`placeEntry` 失敗による drop。合計ロット上限超過の全件 drop（1.11）。`ExitRule not registered` で skip | `LogPort.warn(...)` + 必要に応じて `UiNotifier.notifyEntryExpired` |
| `LogPort.info` | 正常系の可視化 | 正常発注（`entry placed`）。shutdown 時の drop（3.6 / H9）。duplicate entry suppressed（2.7.3） | `LogPort.info(...)` + 必要に応じて `UiNotifier.notifyEntry*` / `notifyExitExecuted` |
| `LogPort.debug` | デバッグ用詳細 | SMA 値・差分・クロス判定の内訳など | `LogPort.debug(...)` |

> **Note**: 旧 H10 の `critical` レベル相当のケース（ゴーストポジション、`availableBalance` が負、`Balance.minus` で負）は、本書では `LogPort.error` で記録しつつ、補償決済等のドメイン処理を即時起動する責務（PositionManager / multi-strategy-entry.md）に集約する。外部チャンネル（Slack 等）への push は infra 側で `Logger` を拡張する形で取り込む（本 PR の対象外）。

**実装上の注意**:

- ドメイン / action 層は `LogPort` のメソッド（`debug` / `info` / `warn` / `error`）を直接呼び、文字列リテラルの level 引数は持たせない（タイポ防止）
- `UiNotifier.notifyEntryExpired` は `EntryCommand` を引数に取るため、TTL 破棄時にも UI 側で「どの戦略のシグナルが消えたか」を一意に特定できる

### 4.2 命名マッピング（再掲 / M12）

| 旧 / 仮称 | 新 / 確定 | 層 |
|---|---|---|
| `DynamicLotCalculator` | `PositionSizingService` | application |
| `MarginBasedLotPolicy` | `MaintenanceRatioBasedLotPolicy` | domain |
| `BalanceCache` | `GmoBalanceAdapter` | adapter/gmo |
| — | `BalancePort` / `RatePort` / `Clock` | port |
| — | `LogPort` / `UiNotifier`（既存。AlertPort は新設しない / 4.1 改訂） | port |
| — | `GmoConstants` | adapter/gmo |

### 4.3 マイグレーション順（全体 / L-7）

各 Step をできる限り独立 PR にする。Step 2〜5 はビルドエラーが連鎖するため 1 PR に束ねる可能性あり。

1. **Step 0**: issue #131 完了 ✅（PR #137 にて完了。`base(pair)` / `quote(pair)` / `pipUnit(pair)` 追加 + `Currency` 型新設）
2. **Step 1**: 値オブジェクト追加（`Money` / `Balance` / `Ratio`(EPSILON) / `Rate` / `MaintenanceRatio` / `MarginRate` / `LotDecisionInput` / `TotalUnits` / `StrategyLots` / `LotAllocation` / `AllocationContext` / `AllocationPolicy` / `EqualWeightAllocationPolicy` / `GmoConstants`）+ テスト
3. **Step 2**: `LotPolicy` interface 書き換え + `MarginBasedLotPolicy` → `MaintenanceRatioBasedLotPolicy` リネーム + 他 Policy（`FixedRatio` / `RiskBased`）の追従
4. **Step 3**: `BalancePort` / `RatePort` / `Clock` / `GmoBalanceAdapter` / `SystemClock` 実装
5. **Step 4**: `PositionSizingService` 追加 + テスト
6. **Step 5**: DB migration `0002` 追加（部分ユニーク制約）+ `PositionRepository.findOpenByPairAndStrategy`
7. **Step 6**: `EntryQueue` 追加 + テスト + `EntryCommand.requiredMargin` 追加（C8 / P10）
   - **前提（NC-2）**: 既存 `EntryCommand` VO に `requiredMargin: Money` フィールドを追加する。`packages/backend/src/domain/command/EntryCommand.ts` の現状 7 フィールド（`pair` / `buySell` / `lot` / `reason` / `convictionScore` / `strategyName` / `entrySnapshot`）に `requiredMargin` を追加。
   - `value-objects.md` の `EntryCommand` 定義改訂は**別 commit / 別 PR で対応**（**value-objects.md 改訂候補**）。Step 6 着手 PR で同時改訂する。
   - 既存 `EntryCommand.of` 呼び出し箇所も `requiredMargin` を埋めるよう改修が必要（影響範囲は `EntryCommand.of` の grep 結果に従い、Step 6 PR 内で一括対応）。
8. **Step 7**: `PositionManager` 追加（別章で扱う）
9. **Step 8**: `TradingSession` の ExitRule ディスパッチ書き換え（戦略別 `Map<StrategyNameValue, ExitRule>`）+ 評価順序の決定論化（H12）
10. **Step 9**: `main.ts` の DI 組み立てを新構造に移行（**DI 配線に絞る** / NL-3）。`AlertPort` の新設は撤回し、既存 `LogPort` + `UiNotifier` の組み合わせで賄う（4.1 改訂）。テストファイルの rename は Step 2 の完了条件に含めるためここでは扱わない。
11. **Step 10**: Rule 側の Lot 計算引き剥がし（brief 改訂候補 P8）
12. **Step 11**: 旧ヘルパ削除（`isJpyQuote` / `resolvePipUnit`）— ✅ Issue #51 Step 9 として実施完了（2026-05-20）。下記の Step 11 詳細を参照
13. **Step 12 (#130)**: `StrategyName` singleton 化 → Map キーを `StrategyName` に戻す（別 PR）

**Step 11 詳細（旧ヘルパ削除）— ✅ 2026-05-20 完了（Issue #51 Step 9 で実施）**

置換対象ファイル（`@deprecated` 関数を呼んでいる箇所、PR #137 時点）:

| ファイル | パッケージ | 旧 API | 新 API |
|---|---|---|---|
| `MarginBasedLotPolicy.ts:42` | backend | `isJpyQuote(pair)` | `quote(pair) === 'JPY'` |
| `Position.ts:14, 145` | backend | `resolvePipUnit(pair)` | `pipUnit(pair)`（Big 経路に統一） |
| `SmaCrossEntryRule.ts:11, 83` | backend | `resolvePipUnit(pair)` | `pipUnit(pair)` |
| `FixedStopLossExitRule.ts:8, 38` | backend | `resolvePipUnit(pair)` | `pipUnit(pair)` |
| `FixedTakeProfitExitRule.ts:8, 37` | backend | `resolvePipUnit(pair)` | `pipUnit(pair)` |
| `TrailingTakeProfitExitRule.ts:8, 38` | backend | `resolvePipUnit(pair)` | `pipUnit(pair)` |
| `CrossStrengthFilterEntryRule.ts:6, 41` | backend | `resolvePipUnit(pair)` | `pipUnit(pair)` |
| `Runner.ts:5, 166` | backtest | `resolvePipUnit(pair)` | `pipUnit(pair)` |
| `IdealExecutionSimulator.ts:9, 58` | backtest | `resolvePipUnit(pair)` | `pipUnit(pair)` |
| `RealisticExecutionSimulator.ts:6, 69` | backtest | `resolvePipUnit(pair)` | `pipUnit(pair)` |
| `OhlcEngine.ts:10, 223` | backtest | `resolvePipUnit(pair)` | **要書き換え（後述）** |
| `TickEngine.ts:10` | backtest | `resolvePipUnit(pair)` | `pipUnit(pair)` |
| `SlippageModel.ts:22, 34, 42` | backtest | constructor `pipUnit: number` | **要書き換え（後述）** |

**backtest 影響箇所（特別対応）**:

`pipUnit` の戻り型が `number` から `Big` に変わったため、backtest 側で `number` の生算術をしている 2 箇所は単純置換不可:

1. `packages/backtest/src/engine/OhlcEngine.ts:223-225` — `priceNum + pipUnit` で `number + number` 算術

   ```ts
   // 旧:
   const pipUnit = resolvePipUnit(pair);
   const priceNum = Number(price.toString());
   const ask = Price.of((priceNum + pipUnit).toFixed(6));
   // 新:
   const ask = Price.of(price.toBig().plus(pipUnit(pair)).toFixed(6));
   ```

2. `packages/backtest/src/simulator/SlippageModel.ts:22, 34, 42` — constructor が `pipUnit: number` を受け取り、`Math.abs(...) * stddevNum * this.pipUnit` のように `number` 演算で使用
   - 呼び出し元（`Runner.ts` 等）で `pipUnit(pair).toNumber()` を渡す形に変更
   - `SlippageModel` 内部は乱数 × number 計算なので `number` のままでよい（境界での変換に閉じる）

**Step 11 の対象外**:

- `pipValuePerLotJpy(pair: CurrencyPair): number`（`PipUnit.ts`）— BT の複利計算ヘルパ。USD/JPY 130 ハードコード解消は別 issue で扱う
- `currencyPairEquals(a, b)` — 利用 2 箇所（`OpenPositions.hasPositionFor`, `MarketSnapshot.equals`）。読み下し用シンタックスシュガーとして残す

**Step 11 の検収条件（機械チェック）— ✅ 2026-05-20 0 行達成**:

```bash
# どちらも 0 行であれば作業完了
git grep -nE 'resolvePipUnit|isJpyQuote' packages/ -- ':!packages/*/dist/'
```

**実施時の判断記録（2026-05-20）**:
- backtest 側は number 経路に深く依存（`Math.abs * stddevNum * pipUnit` 等）するため `pipUnit(pair).toNumber()` で受ける方針を採用
- backend 側は Big 経路に統一（ローカル変数名は `unit` に統一して shadowing を回避）
- `MarginBasedLotPolicy.ts:42` の `isJpyQuote` 利用は本実施時点で既に解消済み（別 PR で削除されていた）
- backtest の typecheck エラー（`LotPolicy.calculateLot` 等）は本 Step とは無関係の既存 develop バグ。別 Issue（#185 系）の射程

ただし `CurrencyPair.test.ts` の `isJpyQuote` import 行（Step 0 で旧/新 API 同値テスト用に残した）も Step 11 で除去対象。`Currency.test.ts` は対象外。

**lint 整備（並行 issue #139）**:

ESLint の `@typescript-eslint/no-deprecated` ルールを別 issue (#139) で導入し、Step 1 〜 Step 10 の間に新規利用が混入しないよう CI で防衛する。Step 11 完了時に `// eslint-disable-next-line` 抑止行が全部消えれば作業完了の機械的目印にもなる。

### 4.4 brief 改訂候補（Note 化）

| ID | 論点 | 場所 | 起票状況 |
|---|---|---|---|
| P1 | `PositionSizingService` を `action/` と `application/` のどちらに置くか | 1.2 | 未起票（本書で `application/` に確定） |
| P2 | 多戦略一括 API（`execute(pair, allocation)`）の是非 | 1.4 | 未起票 |
| P3 | `current()` と `freshNow()` の呼び分け動線 | 1.5 | 未起票 |
| P4 | `AvailableBalance` 値オブジェクトの切り出し | 1.6 | 未起票（設計憲法 6.3 H1 に沿って必要時点で） |
| P5 | `pendingMargin` の取得源（EntryQueue vs PENDING） | 1.6, 2.6 | 未起票 |
| P6 | `RatePort` 実装の配置（MarketDataStream 配線 vs 専用 Adapter） | Step 3 | **配置案 B 確定（増田亨判定）**: RatePort は独立 Port として定義。実装は `MarketDataPort.subscribe` を listener として購読する Tick-driven Adapter（最新 Tick → Rate へ最短経路で変換）。`MarketDataStreamPort` はライフサイクル契約のため最新値クエリは混ぜない。鮮度閾値はコンストラクタ注入。`currentOf` は `Rate \| null`（未到着 = null）、`currentFresh` は鮮度切れで専用例外を throw |
| P7 | 環境変数 `CAPITAL` → `FALLBACK_BALANCE_JPY` リネーム | 1.7 | 未起票 |
| P8 | 既存 `EntryRule` から Lot 計算引数を引き剥がす | 1.9 | 未起票 |
| P9 | `PositionRepository.insertPending` / `markAborted` 正式導入 | 2.6 | **要起票**（PENDING ENUM 追加） |
| P10 | `EntryCommand.requiredMargin(): Money` 追加 | 3.3 | **本 PR で確定採用**。**value-objects.md 改訂候補**として位置付け、Step 6 着手 PR で同時改訂（既存 `EntryCommand` の grep 影響範囲も同時修正） |
| P11 | EntryQueue の TTL / drain 間隔を環境変数化 | 3.5 | 未起票 |
| P12 | shutdown 時の EntryQueue 方針（発注継続 vs 全部 drop） | 3.6 | **本 PR で「全部 drop」に確定** |
| P13 | POST 1 秒制限責務の brief/policies 整合（brief 5.5 を本書 3.4 に合わせて改訂） | 3.4 | **整合済み**（brief 5.5 R1 で確定。本 PR で受入基準・NH-1 注記も追従） |
| P14 | `SizingResult` VO 新設（`{ lot, rate, requiredMargin }`） | 1.4 / 1.6 / 1.11 / 3.9 | **value-objects.md L1433 に反映済**。Step 4（PositionSizingService 追加）と同 PR で実装側を追加 |
| P15 | `Lot.toBig(): Big` メソッド追加（憲法 6.1 完全遵守化） | 1 章末尾 / 3.9 | **value-objects.md 改訂候補**。新規 issue 起票候補 |
| P16 | `DetectedSignals` VO 新設（brief 5.2 で言及） | 1.4.1 | **value-objects.md 改訂候補**。当面は `StrategyName[]` 薄ラッパで可。新規 issue 起票候補 |

**既起票 issue**:

- **#130**: `StrategyName` singleton 化（2.5 / 2.6 / 3.3 / 値オブジェクト 6.6 N-C1）
- **#131**: `CurrencyPair` の `base(pair)` / `quote(pair)` / `pipUnit(pair)` 追加 ✅（PR #137 でクローズ）

**新規起票すべき候補（番号未採番）**:

- P9: `PositionRepository.insertPending` / `markAborted` + `positions.status` ENUM 拡張（`OPEN` / `CLOSED` / `PENDING`）
- P5: `pendingMargin` の源泉を `PositionRepository` へ移す移行（P9 と同一 issue でよい可能性）
- `OpenPositions.totalRequiredMargin()` / `sortedByOpenedAtAsc()` 等の集約メソッド追加（`value-objects.md` N-M1 で言及済みだが独立 issue 推奨）
- `MarketDataStream` に `currentRateOf(pair): Rate` / `currentRateFresh(pair): Rate` を追加（M5）
- `Broker.syncPositionState()` メソッド追加（2.7.1 / M7）
- ~~`AlertPort` interface の正式定義と既存利用箇所の統一（H10 / M9）~~ → 撤回。`LogPort` + `UiNotifier` で賄う（4.1 改訂）。Slack / Discord / Webhook 等の外部通知を追加する場合は別 issue で再検討する
- **P13**: brief 5.5 文書改訂のみ（既存 `GmoRestClient.throttlePost` に責務が集約されている事実に合わせて brief 5.5 の記述を更新。実装変更不要）
<!-- P13 関連の throttlePost 新規実装は不要（既存 GmoRestClient.ts:175 に実装済み） -->
- **P14**: `SizingResult` VO 新設（`domain/position/SizingResult.ts`、`{ lot, rate, requiredMargin }`）
- **P15**: `Lot.toBig(): Big` メソッド追加（`value-objects.md` `Lot` 章に追記）
- **P16**: `DetectedSignals` VO 新設（brief 5.2 と value-objects.md に追記）
- **EntryCommand.requiredMargin** フィールド追加（既存 `EntryCommand` を変更。Step 6 前提として別 commit / 別 PR）
- **テストファイル rename**: `MarginBasedLotPolicy.test.ts` → `MaintenanceRatioBasedLotPolicy.test.ts`（Step 2 完了条件に含める / NL-3）

### 4.5 参照ドキュメント

- `docs/design/position-manager/brief.md` — 決定の要約（PR #128 で 5.1 5 引数化 / 5.2 残余寄せ更新済み）
- `docs/design/value-objects.md` — VO 定義 + 設計憲法 6.1〜6.11（PR #128 で追加）
- `docs/design/sequence/core/multi-strategy-entry.md` — エントリーフロー
- `docs/design/sequence/core/multi-strategy-exit.md` — 決済フロー
- `docs/design/class/position-manager/composition-entry-flow.drawio` — クラス関係（**M1**: 参照パスは実物を確認。クラス図の最新版に揃える）
- `docs/design/sequence/adapter/gmo-account-assets.md` — GmoBalanceAdapter シーケンス
- `docs/design/sequence/adapter/gmo-order-flow.md` — Broker の POST 1 秒制限詳細

### 4.6 参照した既存コード

- `packages/backend/src/main.ts` — DI Composition Root
- `packages/backend/src/domain/position/MarginBasedLotPolicy.ts` — 既存 LotPolicy 実装
- `packages/backend/src/domain/position/LotPolicy.ts` — interface
- `packages/backend/src/domain/rule/StrategyName.ts` — class 実装（#130 で singleton 化予定）
- `packages/backend/src/port/PositionRepository.ts` — 既存 interface
- `packages/backend/src/action/EntryExecution.ts` — 既存実装
- `packages/backend/src/infrastructure/database/schema/positions.ts` — Drizzle スキーマ
- `packages/backend/drizzle/0000_aberrant_union_jack.sql` — 初期 migration
- `packages/backend/drizzle/0001_unique_christian_walker.sql` — strategy_name 追加 migration

### 4.7 設計憲法 6.1〜6.11 への対応表

本書が `value-objects.md` 設計憲法のどこで対応しているかの索引（自己レビュー用）:

| 憲法 | 節 | 本書内の対応箇所 |
|---|---|---|
| 6.1 | 浮動小数誤差（Big 徹底） | 1 章冒頭 Note / 1.8 Step 2 `MaintenanceRatioBasedLotPolicy.decide` Big 徹底版 / 1.10.1 テスト計算根拠 / 3.9 `requiredMargin` Big 計算 |
| 6.2 | エラー階層 | 各章で `throw new Error(...)` の文言にドメイン情報を含める方針を継承（将来 `DomainValidationError` 等に移行） |
| 6.3 | `Balance` / `AvailableBalance` 分岐 | 1.6.2（`availableBalance` の責務） / brief 改訂候補 P4 / `Balance` VO にフォールバックメタを持たせない（1.7） |
| 6.4 | テスト戦略 | 1.10 / 2.8 / 3.10（境界値・例外・等価性・不変性）/ Step 1 で各 VO テスト必須 |
| 6.5 | `equals` と hashCode | 2.5（Map キーの string literal）/ N-C1 準拠 |
| 6.6 | `StrategyName` enum 前提 | 2.5 / 2.6 / 3.3 / 4.3 Step 12 — `StrategyNameValue` を Map キーに使う（#130 未完のため）|
| 6.7 | domain VO は null を返さない | 1.5 `BalancePort.current(): Balance \| null` は port 層の許容 / `RatePort.currentOf` は throw（null 禁止） |
| 6.8 | `Pips` と `Rate` の pip 精度連携 | `CurrencyPair.pipUnit(pair): Big` を使う（PR #137 で追加済み） |
| 6.9 | `Rate.freshNow()` 運用 | 1.5 `RatePort.currentFresh(pair)` と `currentOf(pair)` の使い分け |
| 6.10 | `LotAllocation` / `StrategyLots` キー順序非依存 | 3.10.6 / 1.4 `strategies()` は安定順 / 3.10.2 FIFO は `push` 順 |
| 6.11 | シリアライズ戦略 | 4.1 LogPort / UiNotifier 通知で `strategy: X.value`, `pair: X.toString()` 等ドメイン語彙で出力 |
