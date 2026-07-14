# シーケンス図: GMO注文執行フロー（Adapter層）

> 設計図ファイル（adapter-layer.drawio）に基づく。
> 上位フロー entry-execution.md / market-monitoring.md の
> Broker.placeEntry() / Broker.placeExit() から先の具体的な通信手順を描く。

---

```mermaid
sequenceDiagram
    participant EE as EntryExecution
    participant XE as ExitExecution
    participant GB as GmoBroker
    participant GAC as GmoRestClient
    participant GMO as GMO FX API(外部)
    participant PPR as PostgresPositionRepository
    participant PG as PostgreSQL(外部)

    Note right of EE: Action層：<br/>entry-execution.md から続く。<br/>BrokerがGmoBrokerとは知らない

    Note right of GB: Broker実装：<br/>GMO FX APIの注文体系を<br/>ドメインの言葉に翻訳する

    Note right of GAC: HTTP通信担当：<br/>署名生成とスロットリングを担う

    %% === エントリー注文 ===
    rect rgb(235, 245, 255)
        Note over EE,PG: エントリー注文（完全自動：シグナル検知後に即発注）

        EE->>GB: placeEntry(command)

        GB->>GAC: post("/private/v1/speedOrder", body)<br/>isHedgeable: true

        Note over GAC: HMAC-SHA256署名生成：<br/>timestamp + POST + /v1/speedOrder + body<br/>→ API-SIGN

        Note over GAC: スロットリング確認：<br/>POST 1秒1回制限。<br/>前回送信から1秒未満なら待機

        GAC->>GMO: POST /private/v1/speedOrder<br/>Headers: API-KEY, API-TIMESTAMP, API-SIGN

        GMO-->>GAC: { status: 0, data: { orderId, rootOrderId } }
        GAC-->>GB: Response

        Note over GB: 値オブジェクト変換：<br/>orderId(string) → PositionId<br/>約定価格(string) → Price(entryPrice)<br/>→ EntryResult生成

        GB-->>EE: EntryResult

        Note over EE: Position.open(command, result)<br/>ファクトリメソッドでPosition生成

        EE->>PPR: register(position, entrySnapshot)
        PPR->>PG: INSERT INTO positions<br/>(id, currency_pair, buy_sell, lot,<br/>entry_price, status, strategy_name, opened_at)
        PG-->>PPR: OK
        PPR->>PG: INSERT INTO position_entry_snapshots<br/>(position_id, conviction_score,<br/>spread_pips, entry_hour, entry_day_of_week)
        PG-->>PPR: OK
        PPR-->>EE: 完了
    end

    %% === 決済注文 ===
    rect rgb(255, 240, 235)
        Note over XE,PG: 決済注文（完全自動：ExitRule条件成立で即執行）

        XE->>PPR: findById(command.positionId)
        PPR->>PG: SELECT FROM positions WHERE id = ?
        PG-->>PPR: row
        PPR-->>XE: Position

        Note over XE: extremes があれば<br/>position.applyExtremes(highest, lowest)<br/>→ MFE/MAE を pips に確定

        XE->>GB: placeExit(position)

        Note over GB: Position → settlePosition変換：<br/>positionId, side(反対売買), size

        GB->>GAC: post("/private/v1/closeOrder", body)<br/>settlePosition指定

        Note over GAC: HMAC-SHA256署名生成：<br/>timestamp + POST + /v1/closeOrder + body<br/>→ API-SIGN

        Note over GAC: スロットリング確認：<br/>POST 1秒1回制限

        GAC->>GMO: POST /private/v1/closeOrder<br/>Headers: API-KEY, API-TIMESTAMP, API-SIGN

        GMO-->>GAC: { status: 0, data: { orderId } }
        GAC-->>GB: Response

        Note over GB: 値オブジェクト変換：<br/>約定価格(string) → Price(exitPrice)<br/>損益(number) → Pips(profitLoss)<br/>→ ExitResult生成

        GB-->>XE: ExitResult

        Note over XE: position.close(command, result)<br/>状態遷移：OPEN → CLOSED<br/>exitType, exitReason, profitLoss,<br/>mfePips, maePips を記録

        XE->>PPR: update(position)
        PPR->>PG: UPDATE positions<br/>SET status = 'CLOSED',<br/>exit_price = ?, profit_loss = ?,<br/>closed_at = ?, exit_type = ?,<br/>exit_reason = ?, mfe_pips = ?,<br/>mae_pips = ?<br/>WHERE id = ?
        PG-->>PPR: OK
        PPR-->>XE: 完了
    end
```

### 設計意図

- **EntryExecutionもExitExecutionもGmoBrokerの存在を知らない。** Broker interfaceだけに依存する。実装がGMOかSBIかはAdapter層の関心事であり、Action層の関心事ではない
- **GmoBrokerは翻訳者。** ドメインのEntryCommand/PositionをGMO FX APIの注文パラメータに変換し、レスポンスをドメインのEntryResult/ExitResultに変換する。この双方向の翻訳がAdapterの本質
- **GmoRestClientは通信インフラの専門家。** HMAC-SHA256署名生成とPOST 1秒1回制限のスロットリングを担う。GmoBrokerは署名の詳細を知らなくてよい
- **エントリーと決済の非対称性はAdapter層にも表れる。** エントリーは `/private/v1/speedOrder`（isHedgeable: true で両建て対応）、決済は `/private/v1/closeOrder`（settlePosition指定）と、GMO FX APIの別エンドポイントを叩く。この違いをGmoBrokerが吸収する
- **ExitExecutionはPositionRepositoryからポジションを取得する。** ExitCommand（positionId）を受け取り、findById()でPositionエンティティを復元してからBrokerに渡す。applyExtremes()でMFE/MAEを確定させてからclose()を呼ぶ
- **PostgresPositionRepositoryはSQLの翻訳者。** PositionエンティティとRDBのテーブル行を相互変換する。エントリー時はINSERT、決済時はUPDATE。Domain層はSQLの存在を知らない
- **値オブジェクト変換の境界。** 外部APIのstring型レスポンスがドメインの値オブジェクトに変換されるのは、必ずAdapter層の中。プリミティブ型がドメイン層に漏れ出すことはない
