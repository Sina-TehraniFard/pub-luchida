# シーケンス図: エントリー執行フロー

> 設計図ファイル（action-layer.drawio, trading-session.drawio, positions.drawio）に基づく

---

```mermaid
sequenceDiagram
    participant SC as StrategyCoordinator<br/>(戦略統合)
    participant OQ as OrderQueue<br/>(発注キュー)
    participant LP as LotPolicy<br/>(ロット計算)
    participant EE as EntryExecution
    participant B as Broker
    participant PR as PositionRepository

    Note right of SC: StrategyCoordinatorが<br/>EntryRuleのシグナルを検知し、<br/>OrderQueueに発注を積む

    SC->>OQ: enqueue(entryCommand)

    Note right of OQ: キューに積まれた発注を<br/>1つずつ順番に処理する。<br/>同時発注による競合を防ぐ

    loop キュー内の各entryCommand
        OQ->>LP: calculateLot(entryCommand.strategyName)

        Note right of LP: 口座残高（BalanceCache経由）と<br/>戦略ごとの配分比率から<br/>ロット数を算出する。<br/>同期的に値を返す

        LP-->>OQ: lot

        OQ->>EE: openPosition(command, lot)

        Note right of EE: Action層：<br/>命令書（EntryCommand + lot）を<br/>実行するだけ。判断しない

        EE->>B: placeEntry(command, lot)

        Note right of B: Port層のinterface：<br/>GMOかSBIかを知らない

        B-->>EE: EntryResult

        Note over EE: Position.open(command, result) を呼び出す。<br/>ファクトリメソッドで生成し、<br/>生成時にビジネスルール検証を行う。<br/>strategyNameでポジションと戦略を紐付け

        EE->>PR: register(position, entrySnapshot)

        Note right of PR: Repository：<br/>エンティティの永続化 +<br/>エントリー時スナップショット記録

        EE-->>OQ: 完了

        Note over OQ: Broker失敗時はログ記録し次へ進む。<br/>リトライはしない（1秒制限内で<br/>同じ注文を再試行すると遅延が波及する）
    end

    OQ-->>SC: 全発注完了
```

### 設計意図

- **起点はStrategyCoordinator。** market-monitoring.md でEntryRuleがシグナルを検知した後、StrategyCoordinatorがOrderQueueに発注を積む
- **OrderQueueが発注の順序を制御。** 複数戦略が同時にシグナルを出した場合、キューに積んで1つずつ処理する。同時発注による競合（証拠金不足等）を防ぐ
- **LotPolicyでロット計算。** 口座残高（BalanceCache経由で同期的に取得）と戦略ごとの配分比率からロット数を算出する。EntryExecution自体はロット計算の責務を持たない
- **EntryExecutionは命令書を実行するだけ。** 「エントリーすべきか」の判断はEntryRuleが済ませている。判断と執行の分離
- **BrokerはPort層のinterface。** 実装がGMOかSBIかをEntryExecutionは知らない。依存の方向がドメインからインフラに向かわない
- **Position.open()はファクトリメソッド。** コンストラクタではなくファクトリメソッドで生成することで、生成時のビジネスルール検証を表現する。strategyNameをPositionに持たせ、戦略とポジションを紐付ける
