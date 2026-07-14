# シーケンス図: 起動フロー（システム起動から市場監視開始まで）

> ユーザーがシステムを起動してから、市場監視ループが回り始めるまでの全体像。
> 既存の3つのシーケンス図（tick-to-rule-overview.md, market-monitoring.md, gmo-market-data-flow.md）を繋ぐ「地図」の役割を果たす。

---

## 1. 全体像

```mermaid
sequenceDiagram
    participant Main as アプリケーション<br/>(Composition Root)
    participant TS as TradingSession<br/>(段取り役)
    participant SC as StrategyCoordinator<br/>(戦略統合)
    participant MDS as MarketDataStream<br/>(薄いブリッジ)
    participant 時間足帳簿 as 時間足帳簿<br/>(TimeFrameBook)
    participant KL as CandleHistoryPort
    participant 足組立 as 足組立係<br/>(CandleAccumulator)
    participant 指標台帳 as 指標台帳<br/>(IndicatorLedger)
    participant BC as BalanceCache<br/>(残高キャッシュ)
    participant BP as BalancePort
    participant GMA as GmoMarketDataAdapter<br/>(MarketDataPort実装)
    participant GMO as GMO FX API(外部)

    %% ========================================
    %% Phase 1: 組み立て（DI / Composition Root）
    %% ========================================
    Note over Main,GMO: Phase 1: 組み立て（Composition Root）

    Note over Main: 全ての依存関係はここで<br/>1度だけ組み立てる。<br/>各コンポーネントは<br/>自分の依存を自分で作らない

    Main->>Main: EntryRule[] 生成<br/>(SmaCross, Rsi, 乖離, ヒゲ)
    Main->>Main: ExitRule[] 生成<br/>(各戦略の決済Rule)
    Main->>Main: EntryExecution 生成
    Main->>Main: ExitExecution 生成
    Main->>Main: PositionRepository 生成
    Main->>Main: LotPolicy 生成<br/>(戦略ごとの配分比率)
    Main->>Main: OrderQueue 生成<br/>(EntryExecution, ExitExecution)
    Main->>Main: BalanceCache 生成<br/>(BalancePort)

    Main->>SC: new StrategyCoordinator(<br/>EntryRule[], ExitRule[],<br/>OrderQueue, LotPolicy,<br/>PositionRepository, BalancePort)
    Note over SC: Application層。<br/>全戦略を束ねて評価する。<br/>戦略ごとにポジションを独立管理

    Main->>GMA: new GmoMarketDataAdapter()
    Note over GMA: MarketDataPortの実装。<br/>WebSocket生データを<br/>値オブジェクトに変換する翻訳者

    Main->>KL: new GmoCandleHistoryAdapter()
    Note over KL: CandleHistoryPortの実装。<br/>REST APIで過去の確定足を取得

    Main->>時間足帳簿: new TimeFrameBook(CandleHistoryPort)
    Note over 時間足帳簿: 時間足帳簿は<br/>1分足・1時間足・日足を<br/>束ねて管理する。<br/>MTF分析の入口

    Main->>MDS: new MarketDataStream(<br/>MarketDataPort,<br/>TimeFrameBook)
    Note over MDS: 薄いブリッジ。<br/>tick受信→TimeFrameBookに渡す<br/>→MarketSnapshot受取<br/>→listener通知。<br/>自身はtickの加工も<br/>Snapshot組立もしない

    Main->>TS: new TradingSession(<br/>StrategyCoordinator,<br/>TimeFrameBook, MarketDataStream)
    Note over TS: 段取り役。<br/>start()一発で初期化→市場監視開始を<br/>一貫制御する。<br/>戦略の評価は<br/>StrategyCoordinatorに委譲する

    %% ========================================
    %% Phase 2: 指標初期化（過去データ取得 + 口座情報）
    %% ========================================
    Note over Main,GMO: Phase 2: 指標初期化（過去データ取得 + 口座情報）

    Main->>TS: start(通貨ペア)

    Note over TS: TradingSessionが<br/>起動を主導する。<br/>初期化完了まで<br/>市場監視は始まらない

    TS->>BC: refresh()
    BC->>BP: fetchBalance()
    BP->>GMO: GET /private/v1/account/assets
    GMO-->>BP: 口座残高レスポンス(JSON)
    BP-->>BC: AccountBalance
    Note over BC: 口座残高をキャッシュ。<br/>LotPolicyがロット計算時に<br/>同期的に参照する

    Note over TS: 両建ては speedOrder の<br/>isHedgeable: true で制御。<br/>アカウント設定の変更は不要

    loop 各時間足（1分足, 15分足, 1時間足, 日足）
        TS->>KL: fetchRecent(時間足種別, 本数)
        KL->>GMO: GET /public/v1/klines
        GMO-->>KL: 確定足レスポンス(JSON配列)
        KL-->>TS: List of ConfirmedCandle

        TS->>時間足帳簿: warmUp(時間足種別, 確定足の列)

        Note over 時間足帳簿: 内部で指標台帳.warmUp()→<br/>足組立係.seedHistory()の順に<br/>初期化する。SMA計算可能状態になる
    end

    Note over TS: 全ての時間足で<br/>指標計算が可能になった。<br/>詳細は tick-to-rule-overview.md<br/>セクション1 を参照

    %% ========================================
    %% Phase 3: 起動時接続性チェック → 市場監視開始
    %% ========================================
    Note over Main,GMO: Phase 3: 起動時接続性チェック（fail-fast / #290）

    Main->>GMO: Broker.verifyConnectivity()<br/>GET /private/v1/account/assets
    alt 結線 OK
        GMO-->>Main: status 0
        Note over Main: ExpressServer に auth=ok を記録。<br/>/api/health が公開する
    else 失敗（認証失敗/レート制限/通信断/想定外）
        GMO-->>Main: エラー
        Note over Main: 原因を BrokerError として区別しログに残し、<br/>auth=failed を記録して起動を中止（fail-fast）。<br/>「起動した」≠「正しい設定で起動した」
    end

    Note over Main,GMO: Phase 3: 市場監視開始

    TS->>MDS: start()
    MDS->>GMA: subscribe(onTick): () => void

    Note over GMA: WebSocket接続の確立。<br/>詳細は gmo-market-data-flow.md<br/>を参照

    GMA->>GMO: WebSocket接続要求<br/>wss://forex-api.coin.z.com/ws/public/v1
    GMO-->>GMA: 接続確立
    GMA->>GMO: subscribe(ticker, USD_JPY)
    GMO-->>GMA: 購読開始確認

    Note over TS: 市場監視ループに突入。<br/>ここからシステムは自律的に動く

    GMO->>GMA: tick data(ask, bid, timestamp)

    Note over GMA: 値オブジェクト変換：<br/>string → AskPrice, BidPrice<br/>→ Tick生成

    GMA->>MDS: Tick（コールバック通知）
    MDS->>時間足帳簿: onTick(tick: Tick)

    Note over 時間足帳簿: 足の組み立てと指標計算。<br/>詳細は tick-to-rule-overview.md<br/>セクション2 を参照

    時間足帳簿-->>MDS: MarketSnapshot

    MDS->>TS: onMarketData(snapshot: MarketSnapshot)

    Note over TS: StrategyCoordinatorに委譲。<br/>TradingSession自身は<br/>Ruleを直接呼ばない

    TS->>SC: evaluate(snapshot)

    Note over SC: 全EntryRule/ExitRuleを順に評価。<br/>詳細は market-monitoring.md を参照。<br/>複数戦略が同時にポジションを持てる
```

---

## 2. 既存シーケンス図との関係

| Phase | ステップ | 詳細を描いている既存図 | 説明 |
|-------|----------|------------------------|------|
| Phase 2 | TradingSession.start() の初期化処理 | [tick-to-rule-overview.md](tick-to-rule-overview.md) セクション1 | 各時間足の確定足取得（fetchRecent）、TimeFrameBook.warmUp() の詳細 |
| Phase 3 | tick到着後の足組み立てと指標計算 | [tick-to-rule-overview.md](tick-to-rule-overview.md) セクション2 | CandleAccumulator.accumulate(tick)、足確定判定、IndicatorLedger更新、MarketSnapshot組立の詳細 |
| Phase 3 | Rule判定と自動決済 | [market-monitoring.md](market-monitoring.md) | StrategyCoordinator.evaluate()、EntryRule.shouldEntry()、ExitRule.shouldExit()、ExitExecution.closePosition() の詳細 |
| Phase 3 | WebSocket接続確立と再接続 | [gmo-market-data-flow.md](../../sequence/adapter/gmo-market-data-flow.md) | GmoWebSocketClientの接続管理、keepalive、自動再接続の詳細 |
| Phase 3 | エントリー発注の詳細 | [entry-execution.md](entry-execution.md) | StrategyCoordinator → OrderQueue → LotPolicy → EntryExecution の詳細 |

---

### 設計意図

- **Composition Root で1度だけ組み立てる**: 全ての依存関係はアプリケーション起動時にMainが組み立てる。各コンポーネントは自分の依存を自分で作らない。これにより依存の方向が制御され、テスト時にPort実装を差し替えられる
- **Phase 2 で StrategyCoordinator, LotPolicy, OrderQueue, BalanceCache を追加**: 複数戦略の同時運用に必要なコンポーネント群。全てComposition Rootで組み立てる
- **口座残高を起動時に取得**: BalanceCacheにキャッシュし、LotPolicyがロット計算時に同期的に参照する。BalancePortはGMO APIのREST呼び出しを抽象化する
- **両建てはAPIリクエストで制御**: speedOrder に `isHedgeable: true` を付与することで、アカウントの両建て設定に関係なく新規建てとして約定する。起動時のアカウント設定確認は不要
- **TradingSession が起動の全権を持つ**: 段取り役として口座残高取得 → CandleHistoryPort.fetchRecent() → TimeFrameBook.warmUp() → MarketDataStream.start() の順序を一貫制御する。Main->>TS: start(通貨ペア) の1行で全てが始まる
- **TradingSession は StrategyCoordinator に委譲**: tickディスパッチとセッション管理のみ。Rule評価のループはStrategyCoordinatorが担う
- **MarketDataStream は薄いブリッジ**: tick受信 → TimeFrameBookに渡す → MarketSnapshot受取 → listener通知。自身はtickの加工もSnapshot組立もしない。何もしないことで肥大化を防ぐ
- **エントリーも決済も完全自動**: EntryRuleがシグナル検知 → OrderQueue経由で自動発注。ExitRuleが条件成立 → 即座にExitExecutionで自動決済。人間の判断を介在させない
- **時間足は4種固定**: 1分足（エントリーシグナルの発火元）、15分足（SMAクロス判定）、1時間足（中期トレンドの確認）、日足（大局の方向性確認）。追加時はTimeFrame enumを拡張するだけ
- **起動時接続性チェックで fail-fast（#290）**: 市場監視を始める前に Broker.verifyConnectivity() で private API（account/assets）を1本叩き、正しく結線されているか確認する。失敗（認証失敗・レート制限・通信断・想定外）なら原因に関わらず起動を中止する。「起動した」≠「正しい設定で起動した」を区別し、壊れた API キーのまま稼働し続けること（#287 の検知遅延 65 分）を防ぐ。失敗原因は BrokerError として区別してログに残し、運用者が打ち手を誤らない（正しい鍵を疑う等）ようにする。結果は ExpressServer が保持し /api/health の auth フィールドで公開、luchida -c が起動可否まで監視できる。**現状はどの失敗でも起動中止だが、レート制限など一過性の失敗に対するリトライ/様子見の線引き、および稼働中の連続失敗に対する停止回路（TradingGuard 原型・発注は止めるが Exit は止めない）は #290 Step2 で別途設計する。** authStatus / reportAuthStatus は当面 ExpressServer が保持するが、本来は取引可否を判断する番人（TradingGuard 前身）が持つべき状態の仮宿であり、Step2 で health を番人経由に剥がす想定。剥がす際、実態が「接続性の結果」なので `auth` という語も接続性を表す語に直す（現状は health の後方互換のため `auth` を踏襲）。
  - **Step2 申し送り（認証失敗コードの網羅）**: 現状 GmoApiError.isAuthenticationFailed() は ERR-5012 のみを認証失敗とみなす。署名タイムスタンプずれ・API キー無効など他の認証系コードがあれば `unexpected` に落ち、運用者が鍵を疑えない（#287 と逆向きの取りこぼし）。GMO 仕様で認証失敗コードを洗い出して網羅する
- **TradingGuard は次フェーズ**: 経済指標発表・APIメンテナンス・異常検知で全取引禁止 + ポジション決済指示。3大権威の中で最大権力を持つゲートキーパー。他の権威の命令も握りつぶせる。現在のPhase 1-3のフローに割り込む形で将来追加される
- **この図は「地図」である**: 各Phaseの詳細には深入りせず、既存のシーケンス図に委譲する。起動フローの全体像を俯瞰し、「どこを見ればよいか」を示すナビゲーションの役割を果たす
