# Engine 実装指示書 v2

3体の増田亨レビュー（DDD / パフォーマンス / 金融ドメイン）の全指摘を反映済み。

## 概要

BT 実行基盤の中核 `OhlcEngine` を実装する。確定足を1本ずつ処理し、Rule の判定 → 約定 → Position 管理 → 集計を行い、`BacktestResult` を返す。

**Phase 1（OHLC スキャン）のみ対応。** Phase 2（tick 精密検証）は後続タスク。

## ファイル構成

```
packages/backtest/src/engine/
├── Engine.ts              (既存 interface)
├── EngineConfig.ts        (既存 → 一部追加)
├── OhlcEngine.ts          (今回作成)
├── OhlcEngine.test.ts     (今回作成)
├── ResultCalculator.ts    (今回作成)
└── ResultCalculator.test.ts (今回作成)
```

---

## 前提作業（Engine 実装前に解決すべき本体変更）

### A. ExitType に FORCE_CLOSE を追加

```typescript
// packages/backend/src/domain/command/ExitCommand.ts
export const ExitType = {
  TAKE_PROFIT: 'TAKE_PROFIT',
  STOP_LOSS: 'STOP_LOSS',
  FORCE_CLOSE: 'FORCE_CLOSE',  // ← 追加
} as const;
```

理由: BT 期間終了時の強制クローズは「利確でも損切りでもない」。TradingGuard（次フェーズ）でも必要になる。ドメインの語彙として正当。本体の既存ロジックは TAKE_PROFIT と STOP_LOSS しか使わないので影響ゼロ。

### B. Position.applyExtremes() の pipUnit ハードコード修正

```typescript
// packages/backend/src/domain/position/Position.ts
applyExtremes(highest: Price, lowest: Price): void {
  // before: const pipUnit = 0.01;
  // after: 通貨ペアから pip unit を解決
  const pipUnit = resolvePipUnit(this.pair);
  // ... 以下同じ
}
```

`resolvePipUnit` は CurrencyPair → number のヘルパー。`domain/market/` 配下に配置:

```typescript
// packages/backend/src/domain/market/PipUnit.ts（新規）
export function resolvePipUnit(pair: CurrencyPair): number {
  return String(pair).endsWith('_JPY') ? 0.01 : 0.0001;
}
```

全 pips 計算箇所（Position.applyExtremes, IdealExecutionSimulator.calculatePips, Engine 内）がこのヘルパーを共有する。ハードコードの分散を排除。

### C. ExtremeTracker に updateOhlc メソッドを追加

```typescript
// packages/backend/src/domain/position/ExtremeTracker.ts に追加
/**
 * OHLC モード用。BUY/SELL に依存せず highest と lowest を独立に追跡する。
 * 既存の update() は tick 用（BUY=bid, SELL=ask の片方のみ追跡）。
 * OHLC では足の high/low の両方を記録する必要がある。
 */
updateOhlc(positionId: string, high: Price, low: Price): void {
  const existing = this.tracking.get(positionId);
  if (!existing) {
    this.tracking.set(positionId, { highest: high, lowest: low });
    return;
  }
  this.tracking.set(positionId, {
    highest: high.isHigherThan(existing.highest) ? high : existing.highest,
    lowest: existing.lowest.isHigherThan(low) ? low : existing.lowest,
  });
}
```

理由: 既存の update(posId, bid, ask, buySell) は BUY なら bid のみ、SELL なら ask のみ追跡する。OHLC モードで low=bid, high=ask として渡すと、BUY では high（MFE 候補）が記録されず MFE が系統的に過小評価される。updateOhlc は BUY/SELL に関係なく highest と lowest を独立追跡する。

---

## OhlcEngine の責務

1. DataProvider から確定足を取得
2. warmup 期間をスキップ
3. 足ごとに SnapshotAdapter → Rule → ExecutionSimulator を呼ぶ
4. Position + ExtremeTracker でポジション管理（本体のドメインオブジェクトをそのまま使う）
5. TradeRecord を蓄積
6. 全足処理後に ResultCalculator で BacktestResult を組み立てて返す

### やらないこと

- ParameterSet の読み取り（Runner の責務）
- データの取得方法の判断（DataProvider の責務）
- MarketSnapshot の組み立て（SnapshotAdapter の責務）
- 約定価格の決定（ExecutionSimulator の責務）
- 結果の保存（ResultStore の責務）
- **EntryCommand の組み立て**（Rule が返す。Engine は受け取るだけ）

---

## SnapshotAdapter の interface 変更（slice 問題の解決）

### 問題

現在の interface は全足配列を毎回渡す設計:

```typescript
build(confirmedCandles: ReadonlyArray<ConfirmedCandle>, tick: Tick, nextCandleOpen: Price): MarketSnapshot;
```

525万本の1分足で `candles.slice(0, i+1)` を毎回呼ぶと O(N) コピーが各足で発生し、パフォーマンスが破綻する。

### 解決: 差分方式に変更

```typescript
interface SnapshotAdapter {
  /**
   * 初期化。warmup 足を含む全確定足を渡す。
   * Engine の for ループ開始前に1回だけ呼ぶ。
   */
  warmUp(confirmedCandles: ReadonlyArray<ConfirmedCandle>): void;

  /**
   * 差分の確定足1本を追加して MarketSnapshot を構築する。
   * warmUp 後、足ごとに呼ぶ。
   */
  addCandleAndBuild(
    newCandle: ConfirmedCandle,
    latestTick: Tick,
    nextCandleOpen: Price,
  ): MarketSnapshot;
}
```

BacktestSnapshotAdapter は既に内部で `processedCount` による差分管理をしている。interface を実態に合わせる。

---

## 処理フロー

```
1. DataProvider.fetchCandles(pair, timeframe, dateRange, warmupCount)
   → candles: ConfirmedCandle[] を取得（warmup 分を含む）

2. snapshotAdapter.warmUp(candles.slice(0, warmupCount))

3. for (i = warmupCount; i < candles.length - 1; i++):
   // 注意: candles.length - 1 まで。最終足は「次の足」がないので処理しない
   
   a. currentCandle = candles[i]
      nextCandle = candles[i + 1]  // 約定価格の参照元
   
   b. snapshot = snapshotAdapter.addCandleAndBuild(
        currentCandle,
        makeTick(currentCandle.close, pair),  // latestTick: 現在の足の close
        nextCandle.open,                       // nextCandleOpen
      )
   
   c.【MFE/MAE 更新】（決済判定の前に更新）
      for each openPosition:
        extremeTracker.updateOhlc(posId, currentCandle.high, currentCandle.low)
        // ← BUY/SELL に依存せず highest と lowest を独立追跡（後述）
   
   d.【決済判定】（エントリーより先。ドテン対応）
      for each openPosition:
        exitResult = exitRule.shouldExit(snapshot, position)
        if ExitCommand:
          extremes = extremeTracker.get(posId)
          position.applyExtremes(extremes.highest, extremes.lowest)
          result = executionSimulator.simulateExit(command, nextCandle.open, pair, entryPrice, buySell)
          position.close(command, result)
          → TradeRecord に記録、Map から削除、extremeTracker.remove(posId)
   
   e.【エントリー判定】（1戦略1ポジション制約: 既にオープンがあればスキップ）
      if (openPositions.size > 0): continue  // ← ポジション積み上がり防止
      entryResult = entryRule.shouldEntry(snapshot)
      if EntryCommand:
        result = executionSimulator.simulateEntry(command, nextCandle.open, pair)
        position = Position.open(command, result)
        → Map に追加

4. 未決済ポジションの強制クローズ:
   finalCandle = candles[candles.length - 1]
   for each remaining openPosition:
     // 最終足の MFE/MAE 更新（ループ外なので明示的に実行）
     extremeTracker.updateOhlc(posId, finalCandle.high, finalCandle.low)
     extremes = extremeTracker.get(posId)
     position.applyExtremes(extremes.highest, extremes.lowest)
     exitCommand = ExitCommand.of({
       positionId: position.id,
       type: ExitType.FORCE_CLOSE,
       reason: ExitReason.of('BT 期間終了'),
     })
     result = executionSimulator.simulateExit(cmd, finalCandle.close, pair, entryPrice, buySell)
     position.close(exitCommand, result)
     → TradeRecord に記録

5. ResultCalculator.calculate(trades, metadata) → BacktestResult
```

---

## ExecutionSimulator の interface 変更（snapshot 2回 build 問題の解決）

### 問題

現在の interface は MarketSnapshot を受け取るが、Simulator が使うのは tick 価格のみ。約定用に snapshot を2回 build するのは過剰。

### 解決: Price を直接渡す

```typescript
interface ExecutionSimulator {
  simulateEntry(command: EntryCommand, executionPrice: Price, pair: CurrencyPair): EntryResult;
  simulateExit(command: ExitCommand, executionPrice: Price, pair: CurrencyPair, entryPrice: Price, buySell: BuySell): ExitResult;
}
```

Engine は `nextCandle.open` を Price として渡すだけ。snapshot の2回 build が不要になる。

**IdealExecutionSimulator への影響**: 引数が変わるだけ。ロジック（約定価格をそのまま使う）は同じ。BUY/SELL の方向による ask/bid の分離は Phase 1 では不要（bid-only OHLC の open がそのまま約定価格）。Phase 2（RealisticExecutionSimulator）で bid/ask を分離する。

---

## MFE/MAE の追跡 — high/low を使う

### 問題

指示書 v1 は `currentCandle.close` で MFE/MAE を追跡していた。足の中の極値を見逃す。

### 解決

ExtremeTracker に **OHLC 用メソッド `updateOhlc` を追加** する（前提作業）。

既存の `update(posId, bid, ask, buySell)` は tick 前提で BUY なら bid のみ、SELL なら ask のみを追跡する。OHLC モードで low を bid、high を ask として渡すと、**BUY では low しか追跡されず MFE に必要な high が記録されない。SELL も同様に MFE が過小評価される。**

```typescript
// packages/backend/src/domain/position/ExtremeTracker.ts に追加
/**
 * OHLC モード用。BUY/SELL に依存せず highest と lowest を独立に追跡する。
 * tick モードの update() とは異なり、足の high/low の両方を記録する。
 */
updateOhlc(positionId: string, high: Price, low: Price): void {
  const existing = this.tracking.get(positionId);
  if (!existing) {
    this.tracking.set(positionId, { highest: high, lowest: low });
    return;
  }
  this.tracking.set(positionId, {
    highest: high.isHigherThan(existing.highest) ? high : existing.highest,
    lowest: existing.lowest.isHigherThan(low) ? low : existing.lowest,
  });
}
```

Engine の呼び出し:
```typescript
extremeTracker.updateOhlc(posId, currentCandle.high, currentCandle.low);
```

Position.applyExtremes(highest, lowest) が BUY/SELL に応じて MFE/MAE を計算:
- BUY: MFE = highest - entry, MAE = entry - lowest
- SELL: MFE = entry - lowest, MAE = highest - entry

---

## Position 管理 — 本体のドメインオブジェクトをそのまま使う

### OpenPosition ラッパーは作らない

Position が既に以下を保持:
- `id`, `pair`, `buySell`, `lot`, `entryPrice`, `openedAt`, `strategyName`
- `applyExtremes(highest, lowest)` で MFE/MAE を確定
- `close(command, result)` で決済

ExtremeTracker が別途 highest/lowest を追跡。

```typescript
// Engine 内部
private readonly positions = new Map<string, Position>();
private readonly extremeTracker = new ExtremeTracker();
```

`entryPrice` と `buySell` は `position.entryPrice` / `position.buySell` で取得可能。独自ラッパー不要。

---

## EntryCommand について — Rule が返す。Engine は受け取るだけ

SmaCrossEntryRule.shouldEntry() は `EntryCommand.of({...})` を完全に組み立てて返す。Engine は戻り値をそのまま ExecutionSimulator に渡す。

### Runner の責務: getLot の注入

SmaCrossEntryRule のコンストラクタは `getLot: () => Lot` を受け取る。本番では口座残高から計算するが、BT では **固定 Lot** を返すラムダを注入する。

```typescript
// Runner が Rule を生成する際に
const entryRule = new SmaCrossEntryRule(
  TimeFrame.FIFTEEN_MINUTE,
  () => Lot.of(1000),  // BT 用: 固定 1000 通貨
);
```

これは Runner の責務。Engine は関与しない。

---

## 1戦略1ポジション制約

**Engine は同時に1ポジションのみ保有する。**

```typescript
// エントリー判定の前にガード
if (this.positions.size > 0) continue;
```

理由:
- SmaCrossEntryRule はシグナルが複数足で連続発火する可能性がある
- ガードなしだとポジションが積み上がる
- 本番の TradingSession も `openPositions.isEmpty()` でガードしている

---

## makeTick ヘルパー — bid-only OHLC から Tick を生成

OHLC は bid のみ。MarketSnapshot に Tick が必要（`snapshot.tick` フィールド）。Tick.of() は `ask > bid` を強制する。

```typescript
function makeTick(price: Price, pair: CurrencyPair): Tick {
  const pipUnit = resolvePipUnit(pair);
  // スプレッドを通貨ペアに応じた1 pip に設定
  const priceNum = Number(price.toString());
  const ask = Price.of((priceNum + pipUnit).toFixed(6));
  const bid = price;  // ← bid はそのまま（OHLC の元データが bid）
  return Tick.of(ask, bid, TickTimestamp.of(candle.closeTime.toDate()));
}
```

**v1 からの修正点:**
- `bid = price`（元の bid 値をそのまま維持。v1 では `price - spread` で bid を変えてしまっていた）
- スプレッドは通貨ペア固有の `resolvePipUnit(pair)` を使用（v1 では一律 0.0005 でEUR/USDが壊れていた）
- 1 pip のスプレッドは Phase 1 の近似として妥当

---

## BacktestResult の id / batchId

EngineRunParams に追加:

```typescript
export interface EngineRunParams {
  readonly config: EngineConfig;
  readonly entryRule: EntryRule;
  readonly exitRule: ExitRule;
  readonly dataProvider: DataProvider;
  readonly snapshotAdapter: SnapshotAdapter;
  readonly executionSimulator: ExecutionSimulator;
  // ← 追加
  readonly runId: string;       // crypto.randomUUID()
  readonly batchId: string;     // Runner が生成
  readonly strategy: StrategyType;
  readonly params: Record<string, unknown>;
}
```

Runner が生成して Engine に渡す。Engine は ResultCalculator に中継するだけ。

---

## ResultCalculator

### ファイル分割

```
result/
├── ResultCalculator.ts       — 公開 API（calculate メソッド）
└── ResultCalculator.test.ts
```

内部的にフェーズ分けする（1ファイル内）:

```typescript
export function calculate(input: ResultInput): BacktestResult {
  const basic = calcBasicStats(input.trades);       // Phase 1: 基本統計
  const risk = calcRiskMetrics(input.trades, basic); // Phase 2: リスク指標
  const stability = calcStability(input.trades, basic); // Phase 3: 安定性
  const mfeStats = calcMfeStats(input.trades);      // Phase 4: MFE/MAE 集計
  return assemble(input, basic, risk, stability, mfeStats);
}
```

### ゼロ除算ポリシー（全指標統一）

| 条件 | 結果 |
|---|---|
| 分母 = 0、分子 > 0 | 0 |
| 分母 = 0、分子 = 0 | 0 |
| 分母 = 0、分子 < 0 | 0 |
| tradeCount = 0 | 全指標 0 |

**Infinity / -Infinity は使わない。** JSON シリアライズで壊れるため。全て 0 に統一。

対象箇所:
- payoffRatio = avgWin / avgLoss（lossCount=0）
- profitFactor = grossProfit / grossLoss（grossLoss=0）
- maxDrawdownPct = drawdown / peak（peak=0）
- mfeEfficiency = avgPnl / avgMfe（avgMfe=0）
- sortinoRatio = avgPnl / downsideStddev（全勝 → downsideStddev=0）
- calmarRatio = annualReturn / maxDrawdown（maxDrawdown=0）
- recoveryFactor = totalPnl / maxDrawdown（maxDrawdown=0）
- pnlPerDay = totalPnl / days（同日の場合 days=0 → days=1 に切り上げ）
- sharpeRatio = avgPnl / pnlStddev（pnlStddev=0）

### Calmar Ratio の年率換算

```typescript
const btDays = (dateTo - dateFrom) / 86400000;
const annualReturn = btDays >= 90
  ? (totalPnl / btDays) * 365  // 単純年率（複利換算しない）
  : 0;  // 90日未満は Calmar Ratio を 0 として無効化
```

### 連続勝敗の定義

`pnl > 0` を勝ち、`pnl <= 0` を負けとする（0 pips = 負け扱い）。
理由: スプレッドを考慮すると同値撤退は実質マイナス。

### medianPnl

trades を pnl でソート（O(N log N)）。N が数千程度なので問題なし。

---

## 週末ギャップの扱い

**意図的に含める。** 本番と同条件で約定するため。

金曜の最終足でシグナル → 月曜の最初の足の open で約定。ギャップが大きい場合、BT 結果にそのまま反映される。これは本番でも起きうるリスクなので、BT で排除すべきでない。

---

## テスト戦略

### OhlcEngine テスト（10件）

1. **warmup 期間中は Rule が呼ばれないこと**
2. **決済がエントリーより先に評価されること（ドテン対応）**
3. **時間整合性: Rule は足 N の snapshot、約定は足 N+1 の open**
4. **最終足でのシグナルは無視されること**（i < candles.length - 1 のガード）
5. **未決済ポジションが最終足で FORCE_CLOSE されること**
6. **0トレード（シグナルなし）で正常に BacktestResult が返ること**
7. **MFE/MAE が high/low で更新されること**（close ではなく）
8. **1戦略1ポジション制約: 既存ポジションがあれば EntryCommand を無視**
9. **DataProvider が warmupCount より少ない足を返すケースのエラーハンドリング**
10. **DataProvider が0本を返すケースのエラーハンドリング**

### ResultCalculator テスト（9件）

1. **基本統計**: totalPnl, winRate, profitFactor, avgPnl
2. **ドローダウン**: maxDrawdown, maxDrawdownPct, maxDrawdownDurationMs
3. **シャープレシオ / ソルティノレシオ**
4. **連続勝敗**: maxConsecutiveWins, maxConsecutiveLosses
5. **MFE/MAE 集計**: avgMfe, avgMae, mfeEfficiency
6. **0トレードケース**: 全て 0
7. **1トレードケース**: stddev=0 → sharpeRatio=0
8. **全勝ケース**: lossCount=0 → payoffRatio=0, sortinoRatio=0
9. **全敗ケース**: winCount=0 → profitFactor=0

### Integration テスト（1件）

BacktestSnapshotAdapter（実体）+ SmaCrossEntryRule（実体）+ IdealExecutionSimulator（実体）+ OhlcEngine で end-to-end 実行。10本程度の足データで TradeRecord の entryPrice, exitPrice, mfe, mae が期待値と一致するか検証。

---

## ブランチ戦略

- `backtest/ohlc-engine` を `backtest/main` から切る
- PR は `backtest/main` 向け
- `Refs #71`

## 確認事項

- [ ] Engine interface を正しく implements
- [ ] 前提作業（ExitType.FORCE_CLOSE, Position.applyExtremes の pipUnit, resolvePipUnit, ExtremeTracker.updateOhlc）が完了
- [ ] SnapshotAdapter interface の変更（warmUp + addCandleAndBuild）が反映
- [ ] ExecutionSimulator interface の変更（Price を直接渡す）が反映
- [ ] 時間整合性（足 N で判定、足 N+1 の open で約定）
- [ ] MFE/MAE が high/low で更新されている
- [ ] 1戦略1ポジション制約が実装されている
- [ ] ゼロ除算ポリシーが全指標で統一
- [ ] resolvePipUnit を pips 計算の全箇所で使用
- [ ] 共有カーネル原則違反なし
- [ ] typecheck + テスト通過（OhlcEngine 10 + ResultCalculator 9 + integration 1 = 20件）
