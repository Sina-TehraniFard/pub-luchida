# シーケンス図: tickデータからRule判定までの全体像

> tickがローソク足に組み立てられ、テクニカル指標が計算され、Ruleが判定するまでの流れ。
> 既存の market-monitoring.md の MarketDataStream → TradingSession 間に、
> 「足の組み立て」と「指標計算」という2つの責務を挿入する。

---

## 1. 起動時: 過去データからの指標初期化

```mermaid
sequenceDiagram
    participant TS as TradingSession
    participant 時間足帳簿 as 時間足帳簿<br/>(TimeFrameBook)
    participant 足組立 as 足組立係<br/>(CandleAccumulator)
    participant 指標台帳 as 指標台帳<br/>(IndicatorLedger)
    participant CH as CandleHistoryPort
    participant GMO as GMO FX API(外部)

    Note over TS: 起動時、TradingSessionが<br/>各時間足の過去足を取得し<br/>TimeFrameBookに渡す。<br/>SMA計算に必要なN本の<br/>確定足が揃うまで<br/>市場監視は始まらない

    loop 各時間足（1分足, 15分足, 1時間足, 日足）
        TS->>CH: fetchRecent(時間足種別, 本数)
        CH->>GMO: GET /public/v1/klines<br/>symbol=USD_JPY&interval=1min&date=...
        GMO-->>CH: ローソク足データ(JSON配列)

        Note over CH: 値オブジェクト変換：<br/>openPrice, highPrice,<br/>lowPrice, closePrice<br/>→ 確定足(ConfirmedCandle)の列

        CH-->>TS: ConfirmedCandle[]

        TS->>時間足帳簿: warmUp(時間足種別, 確定足の列)

        Note over 時間足帳簿: 内部処理の順序：<br/>1. 指標台帳.warmUp(確定足)<br/>　 → SMAに過去N本をadd()して初期化<br/>2. 足組立係.seedHistory(確定足)<br/>　 → 次のtickがどの足に属するか判定可能に

    end

    Note over TS: 全ての時間足で<br/>指標計算が可能になった。<br/>市場監視ループを開始できる
```

---

## 2. 通常運用: tickごとの未確定足更新とRule判定

```mermaid
sequenceDiagram
    participant GMA as GmoMarketDataAdapter
    participant MDS as MarketDataStream
    participant 時間足帳簿 as 時間足帳簿<br/>(TimeFrameBook)
    participant 足組立 as 足組立係<br/>(CandleAccumulator)
    participant 指標台帳 as 指標台帳<br/>(IndicatorLedger)
    participant TS as TradingSession
    participant SC as StrategyCoordinator<br/>(戦略統合)

    Note over GMA: gmo-market-data-flow.md<br/>から続く。<br/>tickデータが到着

    GMA->>MDS: Tick(ask, bid, timestamp)

    Note over MDS: tickはただの瞬間価格。<br/>Ruleが必要とするのは<br/>足(OHLC)とSMA値。<br/>ここから「加工」が始まる

    MDS->>時間足帳簿: onTick(tick)

    loop 各時間足（1分足, 15分足, 1時間足, 日足）

        時間足帳簿->>足組立: accumulate(tick)

        Note over 足組立: tickのtimestampから<br/>「どの足に属するか」を判定。<br/>未確定足のHigh/Low/Closeを更新。<br/>例：14:03:27のtickは<br/>14:03:00～14:03:59の1分足に属する

        alt 足が確定した（新しい時間枠のtickが到着）
            足組立-->>時間足帳簿: CandleConfirmed(確定足)

            Note over 足組立: 前の足が確定する条件：<br/>14:04:00のtickが届いたとき<br/>14:03:00の足が確定する。<br/>「次の時間枠の最初のtick」が<br/>確定のトリガーとなる

            時間足帳簿->>指標台帳: onCandleConfirmed(確定足)

            Note over 指標台帳: SMAにadd()する。<br/>確定足のclosePrice。<br/>→ confirmed snapshot 更新<br/>これで指標値が<br/>1本分進む

            指標台帳-->>時間足帳簿: 更新後の指標値

            Note over 足組立: 新しい足の計算を開始。<br/>到着したtickが<br/>新しい未確定足の<br/>Open=High=Low=Closeになる

            足組立->>足組立: startNewCandle(tick)

        else 同じ足の中（未確定足を更新）
            足組立-->>時間足帳簿: CandleUpdated(未確定足)

            Note over 足組立: High/Low/Closeを<br/>tickの値で更新するだけ。<br/>Openは変わらない

            時間足帳簿->>指標台帳: onCandleUpdated(未確定足)

            Note over 指標台帳: SMAにreplace()する。<br/>未確定足のclosePrice。<br/>→ forming snapshot 更新<br/>「もし今この足が確定したら<br/>SMAはいくつになるか」<br/>をリアルタイム算出
        end
    end

    Note over 時間足帳簿: 全時間足の足と指標が<br/>最新状態になった

    時間足帳簿-->>MDS: MarketSnapshot

    Note over MDS: 薄いブリッジ。<br/>tickをTimeFrameBookに渡し、<br/>組み立て済みのMarketSnapshotを<br/>受け取ってlistenerに通知するだけ。<br/>自身はtickの加工も<br/>Snapshot組立もしない

    MDS->>TS: onMarketData(MarketSnapshot)

    Note over TS: TradingSessionは<br/>tick受信とセッション管理のみ。<br/>戦略の評価は<br/>StrategyCoordinatorに委譲する

    TS->>SC: evaluate(MarketSnapshot)

    Note over SC: StrategyCoordinatorが<br/>全EntryRule/ExitRuleを<br/>順に評価する。<br/>詳細は market-monitoring.md を参照

    loop 各EntryRule（SMA, RSI, 乖離, ヒゲ）
        SC->>SC: entryRule.shouldEntry(snapshot)
    end

    loop 各ポジション × 対応するExitRule
        SC->>SC: exitRule.shouldExit(snapshot, position)
    end

    Note over SC: 複数の戦略が同時に<br/>ポジションを持てる。<br/>1ポジション制約は撤廃済み
```

---

## 3. 足確定時の詳細フロー（拡大図）

```mermaid
sequenceDiagram
    participant 足組立 as 足組立係<br/>(CandleAccumulator)
    participant 確定足 as ConfirmedCandle
    participant 未確定足 as FormingCandle
    participant 指標台帳 as 指標台帳<br/>(IndicatorLedger)
    participant SMA短期 as SMA(短期)
    participant SMA長期 as SMA(長期)

    Note over 足組立: ※ SMA の期間は例示。実際の値は<br/>各戦略のコンストラクタで注入する<br/><br/>14:04:00.123 のtickが到着。<br/>現在の未確定足は14:03:00開始。<br/>時間枠が変わった！

    足組立->>未確定足: confirm()

    Note over 未確定足: 未確定足(FormingCandle)が<br/>確定足(ConfirmedCandle)に<br/>変換される。<br/>不変オブジェクトとして確定

    未確定足-->>確定足: ConfirmedCandle<br/>(open, high, low, close,<br/>openTime, closeTime)

    足組立->>指標台帳: onCandleConfirmed(確定足)

    指標台帳->>SMA短期: add(確定足.closePrice)
    SMA短期-->>指標台帳: 新しいSMA(短期)値

    指標台帳->>SMA長期: add(確定足.closePrice)
    SMA長期-->>指標台帳: 新しいSMA(長期)値

    Note over 指標台帳: confirmedSnapshot を更新。<br/>前回の confirmed 値を<br/>previousに退避してから<br/>新しいadd()結果を記録<br/>クロス判定はRule層の責務だが、<br/>「前回値」と「今回値」の<br/>両方が必要

    足組立->>足組立: startNewCandle(tick)

    Note over 足組立: 新しい未確定足を開始。<br/>14:04:00のtickが<br/>Open=High=Low=Close
```

---

## 設計メモ

### 命名の判断理由

| 仮名 | 採用名 | 理由 |
|---|---|---|
| CandleStickBuilder | **足組立係（CandleAccumulator）** | 「Builder」はGoFパターンの技術用語。ドメインの人間は「足を組み立てる」と言う。accumulateは「蓄積する」で、tickを蓄積して足にする行為を正確に表す。builderよりもドメインに近い |
| IndicatorCalculator | **指標台帳（IndicatorLedger）** | 「Calculator」は計算機。しかしこのクラスの本質は「計算すること」ではなく「指標値を管理・保持すること」。台帳（Ledger）は値を記録し保持する帳簿であり、SMA値の現在値・前回値を保持して提供する責務を的確に表す |
| TimeFrameManager | **時間足帳簿（TimeFrameBook）** | 「Manager」は何でも屋の危険信号。帳簿（Book）は「注文帳簿（OrderBook）」と同じ用法で、複数の時間足を束ねて管理する台帳。MTF分析の入口として、足組立係と指標台帳を時間足ごとにペアで保持する |
| MarketData | **相場概況（MarketSnapshot）** | 既存設計ではMarketDataだったが、tickからSMA値まで含む「加工済みの全体像」になった。Snapshotは「ある瞬間の断面」を表し、Ruleが判定に必要な情報の断面写真である |
| 未確定足 | **FormingCandle** | 「形成中の足」。まだ確定していない、変化し続ける足。formingは進行形で「作られつつある」状態を表す |
| 確定足 | **ConfirmedCandle** | 「確定した足」。不変オブジェクト。一度確定したら二度と変わらない |
| SmaSnapshotなし | **SmaSnapshot** | SMA値の断面写真。confirmed（確定足ベース）とforming（未確定足ベース）で同じ構造を共有する。4つのSMA値（短期・長期 × 現在・前回）を不変オブジェクトとして保持 |

### 責務分担の考え方

**「誰が何を知っているか」で責務を切る。**

- **足組立係（CandleAccumulator）**: tickのtimestampと時間枠の関係だけを知っている。SMAの存在を知らない。指標台帳の存在を知らない
- **指標台帳（IndicatorLedger）**: 確定足のclosePriceからSMA値を計算・保持する。trading-signalsライブラリの存在を知っているのはここだけ。足の組み立て方を知らない
- **時間足帳簿（TimeFrameBook）**: 足組立係と指標台帳を時間足ごとにペアで保持する。組み立ての詳細も指標計算の詳細も知らない。「確定した」というイベントを足組立係から受け取り、指標台帳に中継するだけ
- **相場概況（MarketSnapshot）**: 値オブジェクト。振る舞いを持たない。Ruleが判定に必要な情報の断面写真
- **StrategyCoordinator（戦略統合）**: application層。全EntryRule/ExitRuleを束ねて順に評価する。戦略ごとにポジションを独立管理し、複数戦略の同時運用を可能にする
- **TradingSession（段取り役）**: tickディスパッチとセッション管理のみ。戦略の評価はStrategyCoordinatorに委譲する
- **Rule**: 相場概況だけを受け取る。足の組み立て方も、SMAの計算方法も、trading-signalsライブラリの存在も知らない。純粋な判定関数

**既存設計との接合点:**
- MarketDataStreamは薄いブリッジ。tickをTimeFrameBookに渡し、組み立て済みのMarketSnapshotを受け取ってlistenerに通知するだけ。tick加工もSnapshot組立もTimeFrameBookの責務
- TradingSessionのonMarketData内でStrategyCoordinator.evaluate(snapshot)を呼ぶ。TradingSession自身はRuleを直接呼ばない
- EntryRule/ExitRuleのインターフェースが `shouldEntry(snapshot: MarketSnapshot)` に変わる

### 未決定事項

1. **RuleはtickごとにN回呼ばれるのか、足確定時だけ呼ばれるのか？**
   - 現時点の設計: **tickごとに呼ぶ**。未確定足のreplace()でSMAがリアルタイム更新されるため、足確定を待たずにクロスを検知できる
   - トレードオフ: tickごとに呼ぶと「未確定足のSMAクロス→次のtickで元に戻る」という**ダマシ**が発生しやすい
   - 将来の選択肢: Rule側で「確定足ベースのクロスのみ有効」と判断することも可能。その場合、相場概況に「直前の足が確定したか」フラグを持たせる

2. **時間足帳簿が管理する時間足の種類は誰が決めるか？**
   - 候補A: 設定ファイル（YAML等）で定義
   - 候補B: Rule自身が「自分はこの時間足が必要」と宣言する
   - 見解: Ruleが宣言する方がドメインに近い。Ruleは自分の判定に何が必要かを知っている

3. **相場概況（MarketSnapshot）の中身の詳細設計**
   - 全時間足の情報をフラットに持つか、時間足種別をキーとしたMapで持つか
   - クロス状態（GoldenCross/DeadCross/NoCross）は相場概況に含めるか、Rule内で判定するか
   - 見解: クロス判定はRuleの責務。相場概況はSMA値（数値）だけを持ち、それを「クロスした」と解釈するのはRuleの仕事

4. **KLines APIのデータ取得失敗時のリカバリ** → **決定済み**
   - **リトライ**: 指数バックオフ、最大5回
   - **APIメンテ中（全面障害）**: TradingGuard（最大権威）に通知 → 全取引禁止 + ユーザーにポジション決済指示
   - **一部時間足のみ失敗**: Ruleごとに必要な時間足が異なる。そのRuleに必要な足の情報が取れていなければ、そのRuleのみ判定保留。他のRuleは影響なし
   - 例: 1分足のKLinesが取れて日足が取れない場合、1分足だけで動くRuleは稼働可能。日足を必要とするRuleは判定保留
   - 「指標計算可能状態」はRule単位で管理する。TimeFrameBook全体ではなく、各TimeFrameEntryが自身の初期化状態を知る

5. **MarketDataStreamの責務肥大化への対処** → **決定済み**
   - **方針**: TimeFrameBook.onTick(tick): MarketSnapshot に委譲。TimeFrameBookがtickの加工からMarketSnapshot組立まで一貫して担当
   - **MarketDataStreamは薄いブリッジ**: tick受信 → TimeFrameBookに渡す → MarketSnapshot受取 → listener通知。自身はtickの加工もSnapshot組立もしない
   - MarketSnapshotAssemblerのような中間クラスは不要。早すぎる分割は早すぎる最適化と同じ

6. **MarketDataPort のインターフェース設計**
   - 現在の設計: `priceStream(): Observable<MarketData>` — RxJSの型がPort層に漏洩
   - 改善案: `subscribe(listener: MarketDataListener): Subscription` — コールバック型にする
   - 見解: Port層は技術非依存であるべき。ObservableはRxJSの技術概念。コールバック型にすることでPortの純粋性を保つ。ただしSubscription（購読停止手段）は必要
