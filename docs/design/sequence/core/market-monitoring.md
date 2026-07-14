# シーケンス図: 市場監視・自動売買フロー

> 設計図ファイル（rule-layer.drawio, trading-session.drawio, positions.drawio）に基づく

---

```mermaid
sequenceDiagram
    participant MDS as MarketDataStream
    participant TS as TradingSession
    participant SC as StrategyCoordinator<br/>(戦略統合)
    participant ER as EntryRule
    participant XR as ExitRule
    participant UN as UiNotifier
    participant OQ as OrderQueue<br/>(発注キュー)
    participant PR as PositionRepository

    Note right of MDS: Infrastructure層：<br/>WebSocket購読

    Note right of TS: tickディスパッチ +<br/>セッション管理のみ。<br/>戦略の評価は<br/>StrategyCoordinatorに委譲

    Note right of SC: Application層：<br/>全戦略を束ねて評価する。<br/>戦略ごとにポジションを独立管理

    Note right of ER: エントリー判定：<br/>条件成立で自動発注

    Note right of XR: 決済の権威：<br/>条件成立で即座に自動決済

    Note over MDS: start()はTradingSessionから<br/>呼ばれて市場監視を開始する。<br/>詳細は startup-flow.md を参照

    loop 各tick（市場データが到着するたび）
        MDS->>TS: onMarketData(snapshot)

        TS->>SC: evaluate(snapshot)

        Note over SC: エントリー判定ループ

        loop 各EntryRule（SMA, RSI, 乖離, ヒゲ）
            SC->>ER: shouldEntry(snapshot)
            alt EntryCommand（前回DoNothingからの状態変化）
                ER-->>SC: EntryCommand
                SC->>UN: notifyEntryReady(command)
                Note right of UN: UIにシグナル検知を通知
                SC->>OQ: enqueue(entryCommand)
                Note right of OQ: OrderQueueがキューイングし<br/>1つずつEntryExecutionを呼ぶ。<br/>詳細は entry-execution.md を参照
            else DoNothing（前回EntryCommandからの状態変化）
                ER-->>SC: DoNothing
                SC->>UN: notifyEntryExpired(prevCommand)
                Note right of UN: UIにシグナル消失を通知
            else DoNothing（変化なし）
                ER-->>SC: DoNothing
            end
        end

        Note over SC: 決済判定ループ

        SC->>PR: openPositions()
        PR-->>SC: OpenPositions

        loop 各ポジション（strategyNameで紐付け）
            Note over SC: strategyNameから<br/>対応するExitRuleを特定

            SC->>XR: shouldExit(snapshot, position)
            alt DoNothing
                XR-->>SC: DoNothing
            else ExitCommand（利確/損切り条件成立）
                XR-->>SC: ExitCommand

                SC->>OQ: enqueueExit(command)
                Note right of OQ: OrderQueueが決済を優先処理。<br/>詳細は multi-strategy-exit.md を参照
            end
        end

        SC-->>TS: 完了
    end
```

### 設計意図

- **TradingSessionはtickディスパッチとセッション管理のみ。** Rule評価のループはStrategyCoordinatorが担う。TradingSessionは薄く保つ
- **StrategyCoordinatorが全戦略を束ねる。** Application層に位置し、全EntryRule/ExitRuleを順に評価する。戦略ごとにポジションを独立管理する
- **1ポジション制約は撤廃。** 複数の戦略が同時にポジションを持てる。strategyNameでポジションとRuleを紐付ける
- **エントリーも決済も完全自動。** EntryRuleがシグナル検知→OrderQueueに積む→EntryExecutionで自動発注。決済もOrderQueue経由で自動執行。人間の判断を介在させない
- **OrderQueueがエントリーと決済の両方を制御。** GMO POST API の1秒1回制限を1つのキューで管理。決済はエントリーより優先度が高い。詳細は entry-execution.md / multi-strategy-exit.md を参照
- **UiNotifierはシグナル状態の通知のみ。** notifyEntryReady/notifyEntryExpiredはUIにシグナルの検知・消失を表示するためのもの。発注の可否を制御するものではない
- **ExitRuleは3大権威の1つ。** 利確・損切りの全権を握る。条件成立＝即執行
- **市場監視と判定が同一ループ内。** tickごとにエントリー判定→決済判定→OrderQueueへの投入が連続して行われる。実際の発注・決済の執行はOrderQueueが非同期で処理する（詳細は entry-execution.md / multi-strategy-exit.md）
- **Ruleは純粋な判定関数。** shouldEntry/shouldExitを呼ばれて結果を返すだけ。副作用を持たない
- **状態変化時のみ通知。** StrategyCoordinatorが`prevEntryResults`（Map<EntryRule, EntryCommand | DoNothing>）で前回の判定結果を保持し、状態が変わった時のみUiNotifierに通知する（同じ結果が連続しても重複通知しない）
