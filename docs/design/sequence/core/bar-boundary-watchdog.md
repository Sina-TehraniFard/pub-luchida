# シーケンス図: BarBoundaryWatchdog（足境界の壁時計補正）

> Issue #204 の機能設計（aidlc-docs/issue-204/construction/bar-boundary-watchdog/functional-design/）に基づく。
> 自前で組んだ確定足・SMA が、公式 klines とズレていないかを定期的に照合し、ズレていれば公式値を正として訂正するフロー。

---

## この機能が解く問題

- bot は WebSocket の tick を自分で足に組み立て（CandleAccumulator）、SMA を計算している（IndicatorLedger）
- WebSocket は切断・取りこぼしが起きうる。その間に組んだ足はズレる
- そこで「壁時計」（時刻そのもので動くタイマー）を使い、足の境界を少し過ぎたタイミングで公式の確定足を REST で取り直し、内部状態を正す
- **肝**: 壁時計は tick の受信状況に依存しない。WS が切断中で tick が1つも来ていなくても、時刻が来れば必ず発火する。だから「WS が死んでいる間にズレた足」を後から確実に拾える

---

## 1. 正常系（壁時計発火 → 照合 → 補正 → 再スケジュール）

```mermaid
sequenceDiagram
    participant Clock as 壁時計<br/>(BoundaryScheduler)
    participant Reconciler as 調停役<br/>(BarReconciler)
    participant Port as CandleHistoryPort<br/>(公式足取得の入口)
    participant Adapter as GmoCandleHistoryAdapter<br/>(REST実装)
    participant GMO as GMO FX API(外部)
    participant Book as 時間足帳簿<br/>(TimeFrameBook)
    participant Ledger as 指標台帳<br/>(IndicatorLedger)
    participant Accum as 足組立係<br/>(CandleAccumulator)
    participant Logger as Logger

    Note over Clock: Infrastructure層：<br/>「次の足境界 + 15秒」に発火する壁時計。<br/>tick受信に依存しない。<br/>WS切断中でも時刻が来れば必ず動く

    Note over Reconciler: Application層：<br/>外部の時刻イベントを<br/>ドメインへの照合要求に翻訳する調停役。<br/>SMA計算方式・足組立・isStableは知らない

    Note over Port,Adapter: Port/Adapter層：<br/>公式の確定足をREST取得。<br/>既存のwarmUpと同じ口を流用

    Note over Book,Accum: Domain層：<br/>不変条件と再構築ロジックを持つ。<br/>壁時計もRESTも知らない（オニオン型）

    Note over Clock: 各対象足ごとに<br/>「次境界+OFFSET_SEC(15秒)」を計算し<br/>setTimeout登録済み（start時）

    Clock->>Clock: タイマー発火<br/>(例: 15分足が :15:15 に到達)
    Note right of Clock: 15秒待つ理由：<br/>境界直後だと公式klinesに<br/>まだ最新足が反映されていない。<br/>反映待ちのバッファ

    Clock->>Reconciler: reconcile(timeFrame)

    Note over Reconciler: ここから「awaitをまたぐ区間」に入る。<br/>ドメイン状態には一切触らない

    Reconciler->>Port: fetchRecent(timeFrame, RECONCILE_BARS=200)
    Port->>Adapter: fetchRecent(timeFrame, 200)
    Adapter->>GMO: GET /public/v1/klines
    GMO-->>Adapter: klinesレスポンス(JSON配列・末尾は現在進行中の未確定足を含む)
    Note over Adapter: ConfirmedCandle[] に変換し、closeTime が現在時刻(Clock)より<br/>未来の足＝未確定足を除外。確定足だけを返すのが Port の契約。<br/>これを怠ると warmUp・reconcile が未確定足を確定足として扱い汚染する
    Adapter-->>Port: List of ConfirmedCandle（確定足のみ）
    Port-->>Reconciler: official: List of ConfirmedCandle

    Note over Reconciler: await完了。ここから「同期実行区間」。<br/>以降はawaitを挟まず一気に実行する。<br/>その間tick処理は割り込めない（原子性担保）

    Reconciler->>Book: reconcile(timeFrame, official)

    Note over Book: ドメインの唯一の照合入口。<br/>指定足の台帳と足組立係を<br/>公式値で正し、BarReconciledを組み立てる

    Book->>Ledger: reconcileWith(official)
    Note over Ledger: SMAを丸ごと再構築。<br/>移動窓なので1本でも変われば<br/>SMA値が変わる。部分補正より<br/>全列再構築が安全（高々200本）
    Ledger->>Ledger: before = 現在のSMAスナップショット
    Ledger->>Ledger: short/long の SmaTracker を新規生成
    Ledger->>Ledger: official の close を順に再投入<br/>(warmUpと同じ内部ロジックを共有)
    Ledger->>Ledger: after = 再構築後のSMAスナップショット
    Ledger-->>Book: { before, after, corrected }

    Book->>Accum: reconcileLastConfirmed(official[last])
    Note over Accum: 直近の確定足を公式の確定足に差し替え。<br/>forming中の足には触らない<br/>(次のtickが正しく組み直す)
    Accum-->>Book: (確定足を補正)

    Note over Book: OHLC全体を揃える。<br/>closeだけでなくopen/high/lowも公式値に。<br/>BarReconciled（こと）を組み立てる
    Book-->>Reconciler: BarReconciled<br/>(timeFrame, corrected, before, after, maxClosePips)

    Note over Reconciler: 同期実行区間ここまで。<br/>ドメイン状態の変更は完了

    alt corrected == true（内部値と公式値に差分あり）
        Reconciler->>Logger: info("確定足を公式値で補正")
        Note right of Logger: 出力内容：時間足・該当足のopenTime・<br/>内部close・公式close・diff(pips)・<br/>補正前後のSMA。運用者の異常検知用
    else corrected == false（一致）
        Note over Reconciler: ログを出さない。<br/>再構築自体はしたが内部値と公式値が<br/>一致したので記録する意味がない
    end

    Reconciler-->>Clock: 完了（void）

    Clock->>Clock: 次の境界+15秒へ再スケジュール<br/>(setTimeout 再登録)
    Note right of Clock: 発火のたびに次境界を計算し直す。<br/>これで定期的に照合が続く
```

### 補正がエントリーに波及しないこと（BR-9）

- reconcile は足・SMA の**補正のみ**。補正で SMA 関係が変わってもその場でエントリー判定（EntryRule）を能動トリガーしない
- 補正済みの SMA は次の tick / 通常の市場監視ループ（market-monitoring.md）が自然に使う

---

## 2. REST 障害系（公式足が取れなかったとき）

```mermaid
sequenceDiagram
    participant Clock as 壁時計<br/>(BoundaryScheduler)
    participant Reconciler as 調停役<br/>(BarReconciler)
    participant Port as CandleHistoryPort
    participant Adapter as GmoCandleHistoryAdapter
    participant GMO as GMO FX API(外部)
    participant Book as 時間足帳簿<br/>(TimeFrameBook)
    participant Logger as Logger

    Clock->>Reconciler: reconcile(timeFrame)

    Reconciler->>Port: fetchRecent(timeFrame, 200)
    Port->>Adapter: fetchRecent(timeFrame, 200)
    Adapter->>GMO: GET /public/v1/klines
    GMO--xAdapter: タイムアウト / エラー応答
    Note over Adapter: GmoRestClient が fetch に<br/>AbortSignal.timeout を付けるため、<br/>応答が来なくても有限時間で例外になる<br/>（壁時計の永久停止を防ぐ）
    Adapter--xPort: 例外を送出
    Port--xReconciler: 例外を送出

    Note over Reconciler: catch でエラーを受ける。<br/>リトライループは持たない

    Reconciler->>Logger: warn("klines取得失敗。次境界で再試行")
    Note right of Logger: timeFrame と error を添える

    Note over Reconciler,Book: TimeFrameBook には一切触らない。<br/>内部値のまま継続する（クラッシュしない）

    Reconciler-->>Clock: return（補正スキップ）

    Clock->>Clock: 次の境界+15秒へ再スケジュール
    Note right of Clock: 取得失敗は次の足境界で<br/>自然に再試行される。<br/>明示的なリトライは設けない
```

### なぜリトライループを持たないか（BR-8）

- 壁時計は定期的に必ず発火する。次の境界で自然に再試行される
- 独自のリトライループを足すと、複数の再試行が重なって複雑化する。壁時計の周期に任せるのが最も単純で堅牢

---

## 3. 競合制御 — 「awaitをまたぐ区間」と「同期区間」の分離（BR-10）

壁時計と tick は同じ `IndicatorLedger` を触る。両者がデータを壊し合わないための設計が肝になる。

```mermaid
sequenceDiagram
    participant Reconciler as 調停役<br/>(BarReconciler)
    participant Port as CandleHistoryPort
    participant Book as 時間足帳簿<br/>(TimeFrameBook / Domain)
    participant Tick as tick処理<br/>(市場監視ループ)

    Note over Reconciler,Tick: Node.jsは単一スレッド。<br/>だが reconcile は await（REST）をまたぐ。<br/>awaitの隙間に他のタスクが割り込める

    rect rgb(235, 245, 255)
        Note over Reconciler,Port: 【awaitをまたぐ区間】<br/>REST取得。ドメイン状態を触らない。<br/>ここで tick が割り込んでもLedgerは壊れない
        Reconciler->>Port: await fetchRecent(timeFrame, 200)
        Note over Tick: この間にtickが到着しても<br/>tickは自由にLedgerを更新してよい<br/>(まだ補正は始まっていない)
        Port-->>Reconciler: official: List of ConfirmedCandle
    end

    rect rgb(255, 240, 235)
        Note over Reconciler,Book: 【同期実行区間】<br/>awaitを一切挟まない。<br/>イベントループは途中で他タスクに渡らない<br/>＝tickは割り込めない（原子的）
        Reconciler->>Book: reconcile(timeFrame, official)
        Note over Book: ledger.reconcileWith +<br/>accumulator.reconcileLastConfirmed を<br/>一気に同期実行
        Book-->>Reconciler: BarReconciled
    end

    Note over Tick: 同期区間が完了してから<br/>tick処理が動く。<br/>補正の途中状態をtickが見ることはない
```

### 設計のポイント

- **REST 取得（await）は TimeFrameBook を触らない。** 時間のかかる外部 I/O とドメイン状態の変更を物理的に分ける
- **取得完了後の `timeFrameBook.reconcile` は同期的に一気に実行する。** Node.js のイベントループは await を挟まない限り他タスクに制御を渡さない。この性質を使い「補正の途中状態を tick に見せない」を保証する
- 結果として、ロックやミューテックスを使わずに原子性を担保できる

---

## 登場人物と層（まとめ）

| 登場人物 | 層 | 役割 | 知ってよいこと / 知らないこと |
|---|---|---|---|
| BoundaryScheduler（壁時計） | infrastructure | 次境界+15秒に発火し再スケジュール | タイマー機構のみ。ドメインを知らない |
| BarReconciler（調停役） | application | 時刻イベントを照合要求に翻訳 | 対象足種・Port・Book の入口。SMA計算方式・足組立・isStableは知らない |
| CandleHistoryPort / GmoCandleHistoryAdapter | port / adapter | 公式 klines を REST 取得 | GMO REST、レスポンス→ConfirmedCandle変換 |
| TimeFrameBook（時間足帳簿） | domain | ドメインの照合入口。BarReconciledを組み立て | 不変条件。壁時計もRESTも知らない |
| IndicatorLedger（指標台帳） | domain | SMA を丸ごと再構築 | 再構築ロジック。壁時計もRESTも知らない |
| CandleAccumulator（足組立係） | domain | 直近確定足を公式値に差し替え | forming足には触らない |
| BarReconciled | domain（値オブジェクト） | 「照合・是正された」という出来事 | corrected が true のときだけ意味を持つ |

---

### 設計意図

- **watchdog にロジックを持たせない。** BarReconciler は「外部の時刻イベントを、ドメインへの照合要求に翻訳する」だけ。判断（どう正すか）はすべてドメインに閉じる
- **壁時計は tick に依存しない。** WS が切断中でも時刻が来れば必ず発火する。これが「取りこぼした足を後から確実に拾う」仕組みの肝
- **公式値が常に正。** 差分の有無で再構築するか否かを変えない（無条件に再構築）。ただしログは差分があったときだけ出す（corrected == true）
- **SMA は丸ごと再構築。** 移動窓なので窓内の1本でも変われば SMA 値が変わる。部分補正は「どの本が変わったか」を追う複雑さを生むだけ。高々200本ならコストは無視できる
- **OHLC 全体を揃える。** close だけでなく open / high / low も公式値に揃える（ConfirmedCandle が OHLC を Price で保持）
- **REST 障害はリトライしない。** WARN ログを出して return。次の境界で自然に再試行される。bot は内部値のまま継続しクラッシュしない
- **補正はエントリーに波及しない。** reconcile は足・SMA の補正のみ。補正済み SMA は次の tick / 通常の市場監視ループが使う
- **競合制御は await 区間と同期区間の分離で実現。** REST（await）はドメインを触らず、ドメイン変更は同期一括で行う。ロック不要で原子性を担保する
- **テスト容易性。** BoundaryScheduler は clock（現在時刻）と timer（setTimeout）を注入可能にし、テストで時刻を進められる。CandleHistoryPort はモック可能

---

## 関連シーケンス図

| 関連 | 図 | 説明 |
|---|---|---|
| 起動・warmUp | [startup-flow.md](startup-flow.md) | watchdog は warmUp 完了後に起動する（BR-11）。reconcileWith は warmUp と内部ロジックを共有 |
| 補正後の SMA を使う側 | [market-monitoring.md](market-monitoring.md) | 補正済み SMA を次の tick / 市場監視ループが参照する |
| 公式足取得の通信詳細 | [gmo-market-data-flow.md](../adapter/gmo-market-data-flow.md) | GMO REST / WebSocket の通信詳細 |
