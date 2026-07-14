# 多戦略エントリーフロー

> Issue #51 で新設される PositionManager による、複数 EntryRule が同時にシグナルを出したときの発注フロー。
> 既存の `entry-execution.md`（単一命令の執行）と `tick-to-rule-overview.md`（tick から Rule 判定まで）の続きに位置する。

---

## 目的

- 複数の EntryRule（SMA クロス / RSI 逆張り / SMA 乖離逆張り / ヒゲ逆張りなど）が同一 tick で同時にシグナルを返した場合、検知集合を一括で受け取り、配分 → サイジング → 上限チェック → キューイング → 発注まで一気通貫に司令する層（`PositionManager`）の振る舞いを示す
- 「誰が残高を取得するか」「誰が Lot を決めるか」「誰が発注間隔を守るか」「発注失敗時に何が起きるか」を曖昧にせず、参加者ごとの責務を時系列で明確化する
- 古シグナル破棄・(pair, strategy) OPEN ユニーク制約・API 失敗時のフォールバック・ゴーストポジション補償など、失敗系の分岐も 1 本の図に畳み込む

## 前提

- 確定する時間足は個々の Rule が指定する（1 分足 / 15 分足 / 1 時間足 / 日足。Rule ごとに異なる時間足でもよい）。**PositionManager 自身は時間足非依存**
- 稼働中の Rule は `TradingSession.entryRules` に登録済み。現時点で実運用されているのは SMA クロス 1 本のみ。**Rule #2 以降は将来実装**。図では「複数戦略（N 個）」として抽象表現する
- PositionManager は `AllocationPolicy` / `PositionSizingService` / `EntryQueue` / `AlertPort` / `Clock` を DI されている
- 両建て許容設定（GMO API: `isHedgeable: true`）
- `positions` テーブルには `(pair, strategy_name) WHERE status='OPEN'` の部分ユニークインデックスが張られている
- `BalancePort.current()` はキャッシュ値（5 秒 TTL）を返す。`BalancePort.freshNow()` は発注直前のバイパス取得
- `RatePort.currentOf(pair)` は古レート時に例外を投げる（内部で `snapshot.tick.capturedAt` から N 秒（暫定 1 秒）以上経過していれば例外）
- TTL・drain 間隔の時刻判定は全て `Clock` ポート経由。`Date.now()` の直書き禁止

## 登場人物

| 参加者 | 層 | 役割 |
|---|---|---|
| MarketDataStream | infrastructure | 外部 WebSocket から tick / 確定足を受け取り、`MarketSnapshot` を購読者へ配信する薄いブリッジ |
| TradingSession | application | `onMarketData` で全 EntryRule を順に評価し、検知集合を PositionManager に引き渡す |
| EntryRule A..N | domain | 市場データだけを見て「入るか入らないか」を判定。`EntryCommand` か `DoNothing` を返す純粋関数 |
| PositionManager | action | 多戦略シグナルの司令塔。配分・サイジング・上限チェック・キューイングを束ねる |
| PositionRepository | port | 現在の保有ポジション取得、PENDING 登録、発注後の OPEN 確定 |
| AllocationPolicy | domain | 検知シグナル・保有ポジション・残高から `LotAllocation`（配分比率）を返すドメインサービス。初期実装は `EqualWeightAllocationPolicy` |
| PositionSizingService | action | 残高取得・フォールバック・`LotPolicy` 呼び出しを組み立てる。多戦略対応として `scaleDown` を提供（候補） |
| BalancePort | port | 残高取得。`current()` はキャッシュ、`freshNow()` は発注直前のバイパス |
| RatePort | port | 最新レート取得。古い時は例外 |
| LotPolicy | domain | 入力値オブジェクトから Lot を決定する純粋ドメインサービス。初期実装は `MaintenanceRatioBasedLotPolicy` |
| EntryQueue | action | 発注キュー。古シグナル破棄（3 秒 TTL）と順序保持を担う。**1 秒 1 件のレート制限自体は GmoRestClient 側に集約** |
| EntryExecution | action | `EntryCommand` を 1 本実行する既存コンポーネント。判断しない |
| Broker | port | GMO / 他社を抽象化した発注インターフェース。実装は `GmoBrokerAdapter`。内部で `GmoRestClient.throttlePost` がレート制限を担う |
| AlertPort | port | Slack / Discord / Webhook 等への通知抽象。`notify(severity, message, context)` を提供 |
| Clock | port | 時刻取得の抽象。TTL・drain 間隔の基準 |

---

## 初期化 / 終了フロー

```mermaid
sequenceDiagram
    autonumber
    participant TS as TradingSession
    participant EQ as EntryQueue

    Note over TS,EQ: 起動時
    TS->>EQ: start()
    Note over EQ: 内部で setInterval により<br/>短周期（例 100ms）の drain を起動。<br/>実レート制限は GmoRestClient 側

    Note over TS,EQ: 停止時（shutdown）
    TS->>EQ: stop()
    Note over EQ: setInterval を clearInterval。<br/>drainAndWait() で残留コマンドを<br/>TTL 内のものは発注、超過分は破棄
```

Note: `TradingSession` は `entryInProgress` を `onMarketData` 入口で立て、`PM.handleSignals` の `enqueue` 完了時点で false に戻す（下図参照）。実発注は非同期なので、発注完了の await は shutdown 時の `drainAndWait` で明示的に取る。

---

## フロー図（メイン）

```mermaid
sequenceDiagram
    autonumber
    participant MDS as MarketDataStream
    participant TS as TradingSession
    participant ER as EntryRule A..N
    participant PM as PositionManager
    participant PR as PositionRepository
    participant AP as AllocationPolicy
    participant PSS as PositionSizingService
    participant BP as BalancePort
    participant RP as RatePort
    participant LP as LotPolicy
    participant EQ as EntryQueue
    participant EE as EntryExecution
    participant BR as Broker
    participant AL as AlertPort

    Note over MDS: 前提：15分足が確定した<br/>あるいは1分足 tick が到着

    MDS->>TS: onMarketData(snapshot)

    Note over TS: entryInProgress=true<br/>（onMarketData 入口で立てる）

    loop 各 EntryRule
        TS->>ER: shouldEntry(snapshot)
        alt シグナル検知
            ER-->>TS: EntryCommand
        else 検知なし
            ER-->>TS: DoNothing
        end
    end

    Note over TS: 検知集合（例：A, B）を<br/>PositionManager に一括で渡す

    TS->>PM: handleSignals(signals, snapshot)

    alt 検知集合が空
        Note over PM: 何もしない（早期 return）
    else 1 件以上検知

        Note over PM: 残高・ポジションはループ外で 1 回だけ取得。<br/>Rule ごとに取り直さない（enqueue 済みの未約定分が<br/>反映されないため過大評価になる）

        PM->>BP: freshNow()
        alt 取得成功
            BP-->>PM: Balance
        else 取得失敗
            BP-->>PM: null
            Note over PM,AL: エントリーは発注中止。<br/>PM->>AL: notify(warn, "balance unavailable on entry")<br/>※ 決済側はフォールバック続行（対比は exit 図参照）
        end

        PM->>PR: openPositions()
        PR-->>PM: Position[]（status=OPEN）

        Note over PM: availableBalance = balance<br/> - usedMargin(openPositions)<br/> - pendingMargin(PENDING 予約分)<br/>※ pendingMargin の取得源は今後詰める<br/>（EntryQueue.reservedMargin() か<br/> PositionRepository が PENDING を扱うか）<br/>→ brief 改訂候補

        PM->>AP: allocate(context: DetectedSignals + Positions + availableBalance)

        Note over AP: EqualWeightAllocationPolicy：<br/>検知された N 戦略に等ウェイト<br/>例：2 戦略検知なら {A:0.5, B:0.5}

        AP-->>PM: LotAllocation

        loop 各検知 Rule（基準 Lot 算出）
            PM->>PSS: execute(pair)

            PSS->>RP: currentOf(pair)
            alt レート取得成功
                RP-->>PSS: Rate
            else 古レート / 取得失敗
                RP-->>PSS: throw
                Note over PSS,PM: 古値で発注させない。<br/>当該 Rule は発注中止。<br/>他 Rule は続行
            end

            PSS->>LP: decide(LotDecisionInput)
            Note over LP: MaintenanceRatioBasedLotPolicy：<br/>維持率 1.4 倍を守れる Lot を算出

            LP-->>PSS: Lot（基準）
            PSS-->>PM: Lot（基準）
        end

        Note over PM: LotAllocation.apply(baseLot) で<br/>戦略ごとの配分 Lot を組み立てる<br/>（Note L1: VO メソッド化は brief 追記候補）

        PM->>PM: 合計予定 Lot を availableBalance 上限と比較

        alt 合計 Lot > 上限（超過あり）
            PM->>PSS: scaleDown(allocation, context)
            Note over PSS,PM: 維持率制約でスケールダウン。<br/>※ scaleDown のロジック配置は brief 改訂候補<br/>（AllocationPolicy が Lot まで返す案 or<br/> PositionSizingService 多戦略対応案）
            PSS-->>PM: 調整後 LotAllocation
        else 超過なし
            Note over PM: そのまま続行
        end

        loop 各検知 Rule（発注予約）

            Note over PM,PR: ゴーストポジション対策：先行 PENDING 登録。<br/>PR.insertPending は (pair, strategy) WHERE status IN ('OPEN','PENDING')<br/>の部分ユニークで重複を弾く

            PM->>PR: insertPending(pair, strategy, plannedLot, entrySnapshot)

            alt UNIQUE 違反（既に OPEN/PENDING あり）
                PR-->>PM: throw
                Note over PM,AL: 当該 Rule の発注は skip。<br/>PM->>AL: notify(info, "duplicate entry suppressed")
            else 登録成功
                PR-->>PM: pendingId

                Note over PM: entrySnapshot は enqueue 時刻に固定。<br/>約定バーではなく検知バーを残す（Note M4）

                PM->>EQ: enqueue(entryCommand{pendingId}, clock.now())
            end
        end

        Note over TS: entryInProgress=false<br/>（enqueue 完了時点で戻す。<br/>実発注は非同期で継続）
    end

    Note over EQ,BR: EntryQueue 責務: 3 秒 TTL による古シグナル破棄 + 順序保持。<br/>1 秒 1 件のレート制限は GmoRestClient.throttlePost に集約。<br/>EQ の drain は短周期（例 100ms）で発火し、実際の整流は下流で行う

    loop キューが空になるまで（drain 短周期）
        alt 入力時刻から TTL（3秒）超過
            EQ->>EQ: drop(staleCommand)
            EQ->>AL: notify(info, "signal dropped due to TTL", {age, strategy})
            Note over EQ,PR: 補償: PR.markAborted(pendingId)<br/>で PENDING を解放（次 tick のシグナルで再取得可能に）
        else TTL 以内
            EQ->>EE: execute(command)
            EE->>BR: placeEntry(command)
            Note over BR: 内部で GmoRestClient.throttlePost が<br/>直前 POST から 1 秒未満なら待機

            alt API 成功
                BR-->>EE: EntryResult

                EE->>PR: register(position, entrySnapshot, pendingId)
                alt register 成功
                    PR-->>EE: void
                    EE-->>EQ: 完了
                else register 失敗（ゴーストポジション発生）
                    PR-->>EE: throw
                    Note over EE,BR: ブローカー側には建玉が発生済み。<br/>ログだけでは片付けない

                    EE->>BR: placeExit(compensation{brokerPositionId})
                    alt 補償決済 成功
                        BR-->>EE: ok
                        EE->>AL: notify(critical, "ghost position compensated", context)
                    else 補償決済 失敗
                        BR-->>EE: throw
                        EE->>AL: notify(critical, "ghost position compensation FAILED - manual intervention", context)
                    end
                    EE-->>EQ: 失敗
                end
            else API 失敗 (タイムアウト / 5xx / 残高不足)
                BR-->>EE: throw
                EE->>PR: markAborted(pendingId)
                Note over EE: エントリー失敗は次 tick 再評価で OK。<br/>即時リトライはしない（同時注文重複を避ける）。<br/>決済失敗との方針差は exit 図参照
                EE-->>EQ: 失敗
            end
        end
    end
```

---

## 主要なポイント

1. **PositionManager は時間足非依存**。Rule が 1 分足で発火しようが日足で発火しようが、司令塔の処理は同じ
2. **配分とサイジングは分離**。`AllocationPolicy` は戦略ごとの比率を返し、`PositionSizingService` は残高から基準 Lot を返す。将来 Kelly / リスク予算（#121）への差し替えは `AllocationPolicy` の交換で済む
3. **残高・ポジションはループ外で 1 回だけ取得**。Rule ごとに取り直すと enqueue 済みの未約定分を二重計上してしまう。`availableBalance = balance - usedMargin - pendingMargin` で過大評価を防ぐ
4. **ゴーストポジション対策**: 先行 PENDING 登録で (pair, strategy) の重複を DB で弾き、それでも `register` が失敗した場合は補償決済を即実行する。ログだけで流さない
5. **1 秒 1 件制約は GmoRestClient に集約**。`EntryQueue` は「TTL 破棄 + 順序保持」に専念する。責務の二重化を避ける
6. **古シグナル破棄の注意点**: 4 戦略同時検知時、1 秒 1 件ペースで処理すると 4 本目は T=3s 付近で TTL 破棄に引っかかる可能性がある（Note C7）。優先度順（損切り > 利確 > エントリー）や Rule 別 TTL は brief 改訂候補
7. **entryInProgress の境界**: `onMarketData` 入口で true、`enqueue` 完了時点で false。実発注は非同期。shutdown 時の `drainAndWait` で完了を待つ
8. **Clock 経由の時刻判定**: `Date.now()` 直書き禁止。テスト容易性と挙動の決定性のため

## 失敗系・エッジケース

- **検知集合が空**: `handleSignals` 冒頭で早期 return
- **BalancePort.freshNow() が null（エントリー時）**: 発注中止。`AlertPort.notify(warn)`。決済側とポリシーが異なる点に注意（H4）
- **RatePort.currentOf() が例外**: その Rule の発注中止。他 Rule は続行
- **PENDING UNIQUE 違反**: 発注 skip。`AlertPort.notify(info)`
- **EntryQueue で TTL 超過**: シグナル破棄 + PENDING 解放 + `AlertPort.notify(info)`
- **Broker.placeEntry() が失敗**: PENDING 解放。リトライしない。次 tick に委ねる
- **register() 失敗（ゴーストポジション）**: 補償決済を即実行。成功しても critical アラート。失敗時はオペレータ介入 critical アラート

## Note（brief 改訂候補）

- **scaleDown の配置**: `PositionSizingService.scaleDown` か `AllocationPolicy` が Lot まで返す形か、brief 5.2 の「維持率制約でスケールダウン」実装パスを確定する
- **pendingMargin の取得源**: `EntryQueue.reservedMargin()` or `PositionRepository` に PENDING 状態を正式導入
- **Rule 別 TTL / 優先度**: 3 秒一律では 4 戦略同時検知の 4 本目が危うい。brief 5.5 を拡張する候補
- **LotAllocation.apply(baseLot) の VO メソッド化**: 「基準 Lot × 比率 = 配分 Lot」をドメインに閉じる（Note L1）
- **entrySnapshot の鮮度**: enqueue 時刻に固定する方針を brief に追記（Note M4）
- **prevEntryResults の配置**: TradingSession に残すか Rule 側に押し込むか（Note M5）

## 関連ドキュメント

- `docs/design/position-manager/brief.md`（5.1 / 5.2 / 5.4 / 5.5 で本図の前提となる方針）
- `docs/design/sequence/core/entry-execution.md`（EntryExecution 単体の既存フロー）
- `docs/design/sequence/core/tick-to-rule-overview.md`（MarketDataStream から Rule 判定までの前段）
- `docs/design/sequence/core/multi-strategy-exit.md`（決済側の対応フロー）
- `docs/design/sequence/adapter/gmo-account-assets.md`（BalancePort の Adapter 側フロー）
- `docs/design/sequence/adapter/gmo-order-flow.md`（Broker の POST 1 秒制限詳細）
- `docs/design/class/position-manager/composition-entry-flow.drawio`（参加者の静的関係）
