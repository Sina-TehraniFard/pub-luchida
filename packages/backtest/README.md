# @luchida/backtest

FX 自動売買システム Luchida のバックテスト実行基盤。20年分の tick データ（TimescaleDB）から任意の時間足 × 任意の戦略を高速に検証する。

## クイックスタート

### 1. 前提条件

- Node.js v25+
- npm workspace 環境（リポジトリルートで `npm install` 済み）
- DBサーバ（`<PRIVATE_IP>` / Tailscale `<PRIVATE_IP>`）に TimescaleDB が稼働中
- backend がビルド済み（`npm run build -w @luchida/backend`）

### 2. 環境変数の設定

```bash
cp .env.example .env
# .env を編集して接続情報を入力
```

```env
BACKTEST_DB_HOST=<PRIVATE_IP>
BACKTEST_DB_PORT=5432
BACKTEST_DB_NAME=tick_data
BACKTEST_DB_USER=backtest
BACKTEST_DB_PASS=<.env.example 参照>
```

> **注意**: `scripts/` 配下のスクリプトは接続情報をハードコードしている。接続先を変更する場合はスクリプト内を直接編集すること。

### 3. BT 実行

```bash
# backtest ディレクトリに移動
cd packages/backtest

# 単一パラメータで実行
npx tsx scripts/run-bt.ts

# 損切り幅の比較
npx tsx scripts/run-sl-compare.ts
```

### 4. 結果の確認

結果は `tick_data` DB の `backtest` スキーマ（`bt_batches` / `bt_runs` / `bt_trades`）に永続化される。

時刻列（`started_at` 等）は保存値が UTC のため、`SET TIME ZONE 'Asia/Tokyo'` を
前置して JST 表示で確認する（保存値は変えない / #96）。

```bash
# 直近のバッチ一覧（JST 表示）
psql -h <PRIVATE_IP> -U backtest -d tick_data \
  -c "SET TIME ZONE 'Asia/Tokyo';" \
  -c "SELECT id, description, status, started_at FROM backtest.bt_batches ORDER BY started_at DESC LIMIT 10;"

# 特定バッチの run 詳細
psql -h <PRIVATE_IP> -U backtest -d tick_data \
  -c "SET TIME ZONE 'Asia/Tokyo';" \
  -c "SELECT trade_count, win_rate, profit_factor, total_pnl, max_drawdown
        FROM backtest.bt_runs WHERE batch_id = '<batch-id>' ORDER BY total_pnl DESC;"
```

`scripts/query-bt-history.ts` も用意されている（過去バッチの検索用）。`JsonResultStore` の実装も残っているが、現行スクリプトは全て Postgres 永続化を使う。

---

## アーキテクチャ

### 依存方向

```
Runner → Engine → Rule（共有カーネル）
           ↓
    ExecutionSimulator
    DataProvider
    SnapshotAdapter
```

### 処理フロー

```
1. Runner が ParameterSet[] を受け取る
2. 各 ParameterSet について:
   a. RuleFactory で Rule インスタンスを生成
   b. DataProvider / SnapshotAdapter / ExecutionSimulator を生成
   c. Engine.run() を呼ぶ
      - DataProvider.fetchCandles() で確定足を取得（warmup 含む）
      - snapshotAdapter.warmUp() でインジケーター初期化
      - for each 足:
        - snapshotAdapter.addCandleAndBuild() → MarketSnapshot
        - ExtremeTracker.updateOhlc() → MFE/MAE 更新
        - ExitRule.shouldExit() → 決済判定（先に評価。ドテン対応）
        - EntryRule.shouldEntry() → エントリー判定（1戦略1ポジション制約）
        - ExecutionSimulator で約定（足 N+1 の open で約定）
      - 未決済ポジションを FORCE_CLOSE
      - ResultCalculator で 40+ 指標を集計
   d. ResultStore / BatchStore で Postgres に保存（bt_batches / bt_runs / bt_trades）
3. 全結果を返す
```

### 時間整合性（ルックアヘッド防止）

- **判定**: 足 N の confirmed（SMA 等含む）
- **約定**: 足 N+1 の open（判定に使った足の close では約定しない）
- **warmup**: インジケーターが安定するまで Rule を呼ばない
- **MFE/MAE**: 足の high/low で追跡（close ではない）

---

## ディレクトリ構成

```
packages/backtest/
├── .env.example                     # DB 接続情報の雛形
├── package.json
├── tsconfig.json / tsconfig.build.json
├── sql/
│   ├── setup.sql                    # TimescaleDB セットアップ DDL
│   └── README.md                    # DB セットアップ手順
├── scripts/
│   ├── run-bt.ts                    # ベースライン単発実行（Postgres 永続化）
│   ├── run-bt-walk-forward.ts       # ウォークフォワード検証
│   ├── run-bt-oos-validation.ts     # OOS 検証
│   ├── run-bt-period-bias-check.ts  # 期間バイアス確認
│   ├── run-bt-divergence-sweep.ts   # 乖離フィルタ単軸スイープ
│   ├── run-bt-divergence-wf-sweep.ts# 乖離 × WF スイープ
│   ├── run-bt-with-vs-without-divergence.ts  # 乖離あり/なし比較
│   ├── run-bt-baseline-vs-phase3.ts # Phase3 改善対比
│   ├── run-ohlc-vs-tick-compare.ts  # OHLC/tick モード比較
│   ├── analyze-exit-reasons.ts      # 決済理由の集計
│   ├── analyze-monthly-peak.ts      # 月次ピーク分析
│   └── query-bt-history.ts          # 過去バッチ検索
└── src/
    ├── index.ts
    ├── engine/
    │   ├── Engine.ts                # Engine interface
    │   ├── EngineConfig.ts          # 実行条件（pair, timeframe, dateRange, warmupCount, mode）
    │   ├── OhlcEngine.ts            # Engine 実装（OHLC モード）
    │   └── ResultCalculator.ts      # 40+ 指標の集計ロジック
    ├── runner/
    │   ├── Runner.ts                # ParameterSet[] → Engine 実行 → 結果保存
    │   ├── RuleFactory.ts           # ParameterSet → Rule インスタンス生成（ハードコード禁止）
    │   ├── CompositeExitRule.ts     # 複数 ExitRule を1つにラップ
    │   ├── TimeFilteredEntryRule.ts # 時間帯フィルタ（ParameterSet.excludeHoursUtc）
    │   └── TimedExitRule.ts         # 時間ベース強制決済（ParameterSet.maxHoldBars）
    ├── simulator/
    │   ├── ExecutionSimulator.ts    # 約定シミュレーション interface
    │   └── IdealExecutionSimulator.ts  # Phase 1: 足 N+1 open で即約定
    ├── data-provider/
    │   ├── DataProvider.ts          # データ取得 interface
    │   ├── TimescaleDataProvider.ts # TimescaleDB から OHLC/tick を取得
    │   └── TimescaleDbConfig.ts     # 接続情報の型 + 環境変数ローダ
    ├── snapshot-adapter/
    │   ├── SnapshotAdapter.ts       # BT データ → MarketSnapshot 構築 interface（ステートフル）
    │   ├── BacktestSnapshotAdapter.ts  # 実装（IndicatorLedger で SMA を差分計算。状態を持つ）
    │   └── BacktestSmaCalculatorFactory.ts  # trading-signals 直接使用の SMA 実装
    ├── parameter/
    │   ├── ParameterSet.ts          # 4戦略の discriminated union
    │   └── StrategyType.ts          # 本体 StrategyName の再エクスポート
    └── result/
        ├── BacktestResult.ts        # 40+ 指標の型定義（全て pips 建て）
        ├── TradeRecord.ts           # 1トレードの明細
        ├── ResultStore.ts           # 結果保存 interface
        ├── PostgresResultStore.ts   # Postgres 実装（bt_runs / bt_trades）— 現行運用
        ├── BatchStore.ts            # バッチ管理 interface
        ├── PostgresBatchStore.ts    # Postgres 実装（bt_batches）— 現行運用
        └── JsonResultStore.ts       # JSON 実装（残置。テスト・スポット用）

テストファイル（*.test.ts）は各ディレクトリに同居。
```

---

## 主要コンポーネントの詳細

### Runner（`src/runner/Runner.ts`）

```typescript
const runner = new BacktestRunner(
  resultStore,           // PostgresResultStore（bt_runs / bt_trades）
  batchStore,            // PostgresBatchStore（bt_batches）
  () => dataProvider,
  smaFactory,
  EngineMode.OHLC,
  { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 },
  initialCapital,
  codeVersion,           // git ブランチ等
);
const results = await runner.run(parameterSets, batchId, description);
```

- ParameterSet[] を順に実行（逐次。並列化は未対応）
- 各セットで Engine + Rule + Simulator を組み立てて実行
- batchId は全結果で共通。runId は UUID で自動採番
- description はバッチの目的（自然文）。`bt_batches.description` に保存され、後から検索する際の目印になる

### Engine（`src/engine/OhlcEngine.ts`）

```typescript
const engine = new OhlcEngine();
const result = await engine.run(engineRunParams);
```

- 確定足を1本ずつ処理するループ
- 決済 → エントリーの順序（ドテン対応）
- Position + ExtremeTracker でインメモリ管理（本体のドメインオブジェクトをそのまま使用）
- warmup 期間中は Rule を呼ばない
- 未決済ポジションは最終足 close で FORCE_CLOSE
- 最終的に ResultCalculator で 40+ 指標を集計して BacktestResult を返す

### RuleFactory（`src/runner/RuleFactory.ts`）

```typescript
const { entryRule, exitRule } = createRules(parameterSet, getLot);
```

- ParameterSet の `strategy` で分岐（discriminated union）
- **全パラメータは ParameterSet から読み取る。ハードコード禁止**
- SMA_CROSS のルール組み立て:
  1. SmaCrossEntryRule（ベース）
  2. excludeHoursUtc.length > 0 → TimeFilteredEntryRule でラップ
  3. ExitRule: CompositeExitRule([FixedStopLossExitRule, FixedTakeProfitExitRule?, TimedExitRule?, SmaCrossExitRule])
  - takeProfitPips が null なら TP ルールを省略
  - maxHoldBars > 0 で時間ベース強制決済を追加
  - **ExitRule の評価順序: SL → TP → 時間制限 → クロス決済**
- getLot は Runner から注入（リスクベース lot サイジング）
- 他戦略（RSI, 乖離, ヒゲ）は未実装（throw）

### ExecutionSimulator（`src/simulator/`）

```typescript
// Phase 1: 理想約定
const sim = new IdealExecutionSimulator();
const entryResult = sim.simulateEntry(command, executionPrice, pair, executedAt);
const exitResult = sim.simulateExit(command, executionPrice, pair, entryPrice, buySell, executedAt);
```

- 渡された Price でそのまま約定（Phase 1）
- PositionId は UUID で採番
- pips 計算は `resolvePipUnit(pair)` で通貨ペアに応じた pip 単位を使用
- Phase 2（RealisticExecutionSimulator: bid/ask + スリッページ + 遅延）は未実装

### DataProvider（`src/data-provider/`）

```typescript
const provider = TimescaleDataProvider.fromConfig(config);
const candles = await provider.fetchCandles(pair, timeframe, dateRange, warmupCount);
// tick はストリーミング（Phase 2 用）
for await (const tick of provider.fetchTicks(pair, dateRange)) { ... }
await provider.close();
```

- TimescaleDB の `time_bucket` で tick → OHLC 集約
- OHLC は bid 価格から生成（FX 業界慣行）
- warmup 分は from より前から余分に取得
- fetchTicks は pg-query-stream で AsyncIterable（メモリ効率）

### SnapshotAdapter（`src/snapshot-adapter/`）

```typescript
const adapter = new BacktestSnapshotAdapter(pair, timeframe, shortPeriod, longPeriod, smaFactory);
adapter.warmUp(warmupCandles);
const snapshot = adapter.addCandleAndBuild(newCandle, latestTick, nextCandleOpen);
```

- IndicatorLedger で SMA を差分計算（O(1)/足）
- LIVE_TIMEFRAMES 制約: 対象 TimeFrame のみ実データ、残り3種はダミーで埋める
- FormingCandle はダミー（Rule は confirmed しか見ない）
- BacktestSmaCalculatorFactory: 本体と同じ trading-signals ライブラリを使用

### ResultCalculator（`src/engine/ResultCalculator.ts`）

TradeRecord[] から 40+ 指標を計算する。4フェーズ:

1. **基本統計**: totalPnl, winRate, profitFactor, avgPnl, medianPnl, payoffRatio, etc.
2. **リスク**: maxDrawdown, maxDrawdownPct, calmarRatio, recoveryFactor, ulcerIndex, etc.
3. **安定性**: sharpeRatio, sortinoRatio, sqn, maxConsecutiveWins/Losses, pnlStddev
4. **MFE/MAE**: avgMfe, avgMae, mfeEfficiency

全指標は **pips 建て**。ゼロ除算は全て 0 を返す（Infinity 不使用、JSON 互換性のため）。

---

## 本番ロジックとの対応

| 項目 | 本番（main.ts） | BT（Runner + RuleFactory） |
|---|---|---|
| EntryRule | SmaCrossEntryRule(FIFTEEN_MINUTE, calculateLot) | ParameterSet から組み立て（時間帯フィルタ、確認フィルタは ParameterSet で制御） |
| ExitRule 順序 | [FixedStopLossExitRule(15), SmaCrossExitRule(FIFTEEN_MINUTE)] | CompositeExitRule([SL, TP?, SmaCrossExit])。SL/TP は ParameterSet の値 |
| SMA 期間 | SMA_SHORT=20, SMA_LONG=100 | ParameterSet.shortPeriod, longPeriod（可変） |
| Lot | `Math.max(Math.floor(CAPITAL / 10000) * 1000, 100)` | **同じ計算式（複利）**。初期資金 10 万円、1万円あたり 1000 通貨、下限 100 |
| 損切り | 15 pips（tick 即反応） | ParameterSet.stopLossPips（足の close/open で判定。tick ではない） |
| 利確 | なし | ParameterSet.takeProfitPips（null ならなし） |

### 本番との違い（意図的）

- **約定タイミング**: 本番は tick 即反応。BT は足 N+1 の open で約定（OHLC モードの制約）
- **損切り判定**: 本番は tick 単位。BT は足の close/open 時点で判定（足内のヒゲは損切りに反映されない）
- **MFE/MAE**: 本番は tick 単位で追跡。BT は足の high/low で追跡（概算値）
- **スプレッド**: 本番は GMO の実スプレッド。BT は 1 pip 固定の近似（約定価格には影響しない）

---

## ParameterSet の定義

**必須ルール: チューニング可能なパラメータは全て ParameterSet に定義する。RuleFactory やスクリプトにハードコードしてはならない。**

RuleFactory は ParameterSet の値だけを読み取って Rule を組み立てる。スクリプトは ParameterSet 配列を Runner に渡すだけ。Engine を直接叩いてパラメータをバイパスしてはならない。

```typescript
type ParameterSet =
  | SmaCrossParameters      // strategy: 'SMA_CROSS'
  | RsiReversalParameters   // strategy: 'RSI_REVERSAL'（未実装）
  | SmaDistanceParameters   // strategy: 'SMA_DISTANCE'（未実装）
  | WickReversalParameters; // strategy: 'WICK_REVERSAL'（未実装）

// SmaCrossParameters の全フィールド
{
  strategy: 'SMA_CROSS',
  pair: CurrencyPair('USD_JPY'),
  timeframe: TimeFrame.FIFTEEN_MINUTE,
  dateFrom: new Date('2006-01-01'),
  dateTo: new Date('2026-03-31'),
  shortPeriod: 20,              // 短期 SMA 期間
  longPeriod: 100,              // 長期 SMA 期間
  stopLossPips: 40,             // 損切り幅（pips）
  takeProfitPips: 150,          // 利確幅（pips）。null ならクロス決済のみ
  excludeHoursUtc: [0, 7, 18], // 除外時間帯（UTC）。[] ならフィルタなし
  maxHoldBars: 192,             // 保有本数の上限（時間ベース強制決済）。0 で無効
  riskPct: 0.02,                // 1トレードあたりの許容リスク（資金に対する割合）
}
```

---

## BacktestResult の全フィールド

全て **pips 建て**。trades 配列に個別トレードの明細を含む。

| カテゴリ | フィールド | 説明 |
|---|---|---|
| 識別 | id, batchId | 実行 ID / バッチ ID |
| 条件 | pair, timeframe, strategy, params, dateFrom, dateTo | 実行条件 + 戦略パラメータ |
| 収益性 | totalPnl, netPnlPips | 総損益（同値。DB 互換で両方持つ） |
| | grossProfit, grossLoss | 粗利 / 粗損（絶対値） |
| | avgPnl, avgWin, avgLoss | 平均損益 / 平均利益 / 平均損失 |
| | medianPnl | 損益の中央値 |
| | largestWin, largestLoss | 最大利益 / 最大損失 |
| | payoffRatio, profitFactor | ペイオフレシオ / PF |
| | expectancyPips, pnlPerDay | 期待値 / 日次損益 |
| 勝率 | tradeCount, winCount, lossCount | 件数 |
| | winRate, longWinRate, shortWinRate | 勝率（全体 / BUY / SELL） |
| | longCount, shortCount, tradesPerMonth | BUY/SELL 件数 / 月間取引数 |
| リスク | maxDrawdown, maxDrawdownPct, maxDrawdownDurationMs | 最大 DD（pips / 率 / 期間） |
| | avgDrawdown, ulcerIndex | 平均 DD / Ulcer Index |
| | calmarRatio, recoveryFactor | Calmar / 回復係数 |
| 安定性 | sharpeRatio, sortinoRatio, sqn | リスク調整後リターン |
| | pnlStddev | 損益の標準偏差 |
| | maxConsecutiveWins, maxConsecutiveLosses | 最大連勝 / 連敗 |
| MFE/MAE | avgMfe, avgMae, mfeEfficiency | MFE/MAE 集計 |
| 時間 | avgHoldingPeriodMs | 平均保有期間 |
| メタ | status, ranAt, durationMs | 実行ステータス / 日時 / 所要時間 |
| 明細 | trades: TradeRecord[] | 個別トレード配列 |

---

## 共有カーネル原則

`@luchida/backend` と `@luchida/backtest` は Shared Kernel パターンで結合している。

### import できるもの

`@luchida/backend/domain/*` のみ。以下は代表例（実際のガードは ESLint + package.json exports の二重ガードで物理的に強制される）:

- Rule: EntryRule, ExitRule, SmaCrossEntryRule, SmaCrossExitRule, FixedStopLossExitRule, StrategyName
- Market: MarketSnapshot, TimeFrameSnapshot, ConfirmedCandle, FormingCandle, Tick, TickTimestamp, Price, Pips, CurrencyPair, TimeFrame, LIVE_TIMEFRAMES, durationMs, Timestamp, BuySell, resolvePipUnit
- Position: Position, PositionId, Lot, ExtremeTracker
- Command: EntryCommand, ExitCommand, EntryResult, ExitResult, EntryReason, ExitReason, ExitType, DoNothing, ConvictionScore, EntrySnapshot
- Indicator: IndicatorLedger, IndicatorValues, SmaSnapshot, SmaValue, SmaCalculatorFactory

### import できないもの

ESLint + package.json exports の二重ガードで物理的にブロック:
- `infrastructure/` — DB, HTTP, WebSocket, Logger
- `application/` — TradingSession
- `adapter/` — GmoRestClient, GmoWebSocketClient
- `port/` — Broker, PositionRepository
- `action/` — EntryExecution, ExitExecution

### BT 側の禁止事項

1. domain 型の拡張・変更（backend に PR を出して議論する）
2. domain の再発明（BT 用 Position 等を独自実装しない）
3. infrastructure 層への依存（ESLint で強制）
4. `as any` キャスト（domain の型を迂回しない）
5. `src/domain/` ディレクトリを作らない

---

## DB セットアップ

TimescaleDB のセットアップ手順は `sql/README.md` を参照。

```bash
# DBサーバで実行
sudo -u postgres psql -d tick_data -f sql/setup.sql
```

### データ

- 3ペア（USD/JPY, EUR/USD, GBP/USD）× 20年（2006-2026）= 14億行の tick
- `time_bucket` で任意の時間足に SQL 1発で集約
- 欠損ゼロ確認済み（2026-04-11）

### 接続情報

```
Host: <PRIVATE_IP>（LAN）/ <PRIVATE_IP>（Tailscale）
Port: 5432
Database: tick_data
User: backtest
Password: <.env 参照>
```

---

## 開発コマンド

```bash
# 型チェック
npm run typecheck -w @luchida/backtest

# テスト実行（56件）
npm run test -w @luchida/backtest

# ビルド
npm run build -w @luchida/backtest

# backend ビルド（runtime の exports 解決に必要）
npm run build -w @luchida/backend
```

### 重要: backend のビルド

backtest の runtime は backend の `dist/` ディレクトリの `.js` ファイルを参照する（package.json `exports` の `default` フィールド）。backend の domain を変更したら `npm run build -w @luchida/backend` を実行すること。忘れると `TypeError: LIVE_TIMEFRAMES is not iterable` 等のランタイムエラーが発生する。

---

## スクリプトの書き方

**必須: スクリプトは ParameterSet 配列を定義し、Runner.run() に渡す。Engine を直接叩いてはならない。**

### 基本パターン

実装の最新形は `scripts/run-bt.ts` を参照。要点だけ抜粋:

```typescript
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import { TimescaleDataProvider } from '../src/data-provider/TimescaleDataProvider.js';
import { loadTimescaleDbConfigFromEnv } from '../src/data-provider/TimescaleDbConfig.js';
import { PostgresResultStore } from '../src/result/PostgresResultStore.js';
import { PostgresBatchStore } from '../src/result/PostgresBatchStore.js';
import { BacktestRunner } from '../src/runner/Runner.js';
import { BacktestSmaCalculatorFactory } from '../src/snapshot-adapter/BacktestSmaCalculatorFactory.js';
import { EngineMode } from '../src/engine/EngineConfig.js';
import type { SmaCrossParameters } from '../src/parameter/ParameterSet.js';

async function main() {
  // 接続情報は .env から読む。冒頭の `import 'dotenv/config'` で .env を process.env に展開し、
  // loadTimescaleDbConfigFromEnv が必須環境変数の欠落を例外で検出する。
  const dbConfig = loadTimescaleDbConfigFromEnv();

  const dataProvider = TimescaleDataProvider.fromConfig(dbConfig);
  const resultPool = new Pool(dbConfig);
  const resultStore = new PostgresResultStore(resultPool);
  const batchStore = new PostgresBatchStore(resultPool);
  const smaFactory = new BacktestSmaCalculatorFactory();

  const runner = new BacktestRunner(
    resultStore,
    batchStore,
    () => dataProvider,
    smaFactory,
    EngineMode.OHLC,
    { slippageStddevPips: 0, executionDelayMs: 0, randomSeed: 0 },
    100_000,                              // initialCapital
    'feat/my-experiment',                 // codeVersion（後追跡用）
  );

  const params: SmaCrossParameters = {
    strategy: 'SMA_CROSS',
    pair: CurrencyPair('USD_JPY'),
    timeframe: TimeFrame.FIFTEEN_MINUTE,
    dateFrom: new Date('2006-01-01T00:00:00Z'),
    dateTo: new Date('2026-03-31T00:00:00Z'),
    shortPeriod: 20,
    longPeriod: 100,
    stopLossPips: 40,
    takeProfitPips: 150,
    excludeHoursUtc: [0, 7, 18],
    maxHoldBars: 192,
    riskPct: 0.02,
  };

  const batchId = randomUUID();
  try {
    const [r] = await runner.run([params], batchId, 'このバッチの目的');
    console.log(`トレード数: ${r!.tradeCount} / 勝率: ${(r!.winRate * 100).toFixed(1)}% / PF: ${r!.profitFactor.toFixed(2)}`);
    console.log(`SELECT * FROM backtest.bt_runs WHERE batch_id = '${batchId}';`);
  } finally {
    await dataProvider.close();
    await resultPool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

> **必須**: 新規スクリプトは `description`（バッチの目的を表す自然文）を `runner.run()` の第3引数に必ず渡すこと。これが `bt_batches.description` になり、後から「あの実験どれだったっけ」を検索するときの唯一の手がかりになる。

### パラメータ比較（共通部分を BASE で共有）

```typescript
const BASE = {
  strategy: 'SMA_CROSS' as const,
  pair: CurrencyPair('USD_JPY'),
  timeframe: TimeFrame.FIFTEEN_MINUTE,
  dateFrom: new Date('2006-01-01'),
  dateTo: new Date('2026-03-31'),
  shortPeriod: 20,
  longPeriod: 100,
  stopLossPips: 40,
  takeProfitPips: 150,
  excludeHoursUtc: [0, 7, 18],
  maxHoldBars: 192,
  riskPct: 0.02,
};

// 変えたいパラメータだけスプレッドで上書き
const parameterSets: SmaCrossParameters[] = [
  { ...BASE },                          // ベースライン
  { ...BASE, stopLossPips: 30 },        // SL だけ変更
  { ...BASE, maxHoldBars: 96 },         // 24h制限に変更
];

const results = await runner.run(parameterSets, 'compare-batch');
```

### パラメータスイープ

```typescript
const parameterSets: SmaCrossParameters[] = [];
for (const short of [5, 10, 15, 20, 25]) {
  for (const long of [50, 75, 100, 150, 200]) {
    if (short >= long) continue;
    parameterSets.push({ ...BASE, shortPeriod: short, longPeriod: long });
  }
}
const results = await runner.run(parameterSets, 'sweep-batch');

// 結果を PF 順にソート
results.sort((a, b) => b.profitFactor - a.profitFactor);
for (const r of results.slice(0, 5)) {
  console.log(`SMA(${r.params.shortPeriod}/${r.params.longPeriod}) PF=${r.profitFactor.toFixed(2)} pnl=${r.totalPnl.toFixed(0)}`);
}
```

---

## 新戦略の追加手順

新しい戦略（例: RSI_REVERSAL）を BT に追加するには以下の4ステップ:

1. **`src/parameter/ParameterSet.ts`** — discriminated union に新メンバーを追加
   ```typescript
   export interface RsiReversalParameters extends BaseParameters {
     strategy: Extract<StrategyType, 'RSI_REVERSAL'>;
     rsiPeriod: number;
     oversoldThreshold: number;
     overboughtThreshold: number;
   }
   ```
2. **`src/runner/RuleFactory.ts`** — `createRules()` と `calcWarmupCount()` の switch に新 case を追加
3. **`src/runner/Runner.ts`** — `createSnapshotAdapter()` に新 case を追加（SMA 以外のインジケーターを使う場合は SnapshotAdapter の拡張が必要）
4. **backend 側** — 新 Rule の実装（EntryRule / ExitRule）を `domain/rule/` に追加（共有カーネル。backend に PR を出す）

> 現状 `createRules` / `calcWarmupCount` / `createSnapshotAdapter` / `collectIndicatorSpecs` の switch は `default: throw` で書かれており、新メンバーを追加してもコンパイルエラーにはならず、実行時に「未対応の戦略」例外で落ちる。網羅性を型で守るには各 switch の `default` を廃し `assertNever(ps)` を置く必要がある（別タスク）。
>
> 既存戦略にパラメータを 1 つ足す場合は ParameterSet の定義に加えるだけでよい。DB 記録（`bt_runs.params`）は `Runner.extractStrategyParams` が共通フィールド（`BASE_PARAMETER_KEYS` + `strategy`）を除いた全フィールドを自動展開するため、記録漏れは起きない（#111）。共通フィールドを増やす場合は `ParameterSet.ts` の `BASE_PARAMETER_KEYS` を更新する（`satisfies` は過剰列挙のみを防ぎ、更新漏れ（列挙漏れ）は `MissingBaseParameterKeys` の `never` アサートがコンパイル時に検出する）。

---

## 既知の制約（Phase 1）

| 制約 | 理由 | Phase 2 での対応 |
|---|---|---|
| 約定が足 N+1 の open（tick ではない） | OHLC モードの本質的制約 | RealisticExecutionSimulator で tick ベース約定 |
| 損切りが足単位（tick 瞬間値ではない） | 同上 | tick モードで即反応 |
| スプレッド 1 pip 固定 | Phase 1 の近似 | 通貨ペア・時間帯別の動的スプレッド |
| MFE/MAE が足の high/low（概算） | 足内の順序不明 | tick で精密追跡 |
| 全指標 pips 建て（通貨建てなし） | ResultCalculator は pips のみ集計 | 通貨建て指標を追加 |
| SMA_CROSS 戦略のみ | 初期実装 | RSI, 乖離, ヒゲ を追加 |
| 1戦略1ポジション制約 | 本番と同じ | 複数ポジション対応は検討 |

---

## 関連 Issue

- #59 データ基盤（TimescaleDB + Dukascopy）— 完了
- #70 約定シミュレーター（RealisticExecutionSimulator）— 未着手
- #71 BT 実行基盤（本パッケージ）— 完了
- #74 DB 保存基盤（bt_batches / bt_runs / bt_trades）— 完了
- #75 月間成績管理画面 — backlog
- #79 domain → infrastructure 違反解消 — 完了
