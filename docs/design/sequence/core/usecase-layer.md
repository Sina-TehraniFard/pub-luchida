# シーケンス図: UseCase層による責務分離フロー

> ExpressServer が直接ドメインロジックを呼ばず、UseCase を経由する構造を描く。
> 増田亨レビューで指摘された依存方向違反（ExpressServer → GmoRestClient）の解消。

---

## 緊急全決済（実装済み: EmergencyCloseAllUseCase）

> 実装: `application/EmergencyCloseAllUseCase.ts`（Issue #52 Step 2）

```mermaid
sequenceDiagram
    participant CL as Client(フロントエンド)
    participant ES as ExpressServer
    participant UC as EmergencyCloseAllUseCase
    participant B as Broker
    participant PR as PositionRepository

    Note right of CL: フロントエンド：<br/>緊急全決済ボタンを押す

    Note right of ES: HTTPサーバー：<br/>リクエストを受けてUseCaseを呼ぶだけ

    Note right of UC: UseCase層：<br/>ビジネスロジックを集約。<br/>ExitCommand生成とPosition.close()を担う

    CL->>ES: POST /api/emergency-close-all
    ES->>UC: execute()

    UC->>PR: openPositions()
    PR-->>UC: OpenPositions

    par 各ポジション（並列・best-effort）
        Note over UC: ExitCommand生成（type: FORCE_CLOSE / 理由: 緊急全決済）<br/>STOP_LOSS にしない：損切り成績の分析を汚染しないため
        UC->>B: placeExit(position)

        alt 決済成功
            B-->>UC: ExitResult

            Note over UC: 状態遷移：OPEN→CLOSED
            UC->>UC: position.close(command, result)
            UC->>PR: update(position)
        else 決済失敗（API障害等）
            B-->>UC: エラー
            Note over UC: 失敗を記録し、他のポジションの決済は継続。<br/>sync の fail-fast とは逆の判断：<br/>緊急時は「閉じられるものから閉じる」が正。<br/>「発注失敗」と「決済成立済み・DB未反映」は区別して記録
        end
    end

    Note over UC: 全体タイムアウト 30 秒で打ち切り。<br/>未決着分は unresolved として返し操作者に<br/>ブローカー側の確認を促す。発注済みの決済注文は<br/>取り消されず、DB 反映は次回 sync で収束する<br/>（前提: sync が対象ペアをカバーしていること）

    Note over UC: 再入ガード：前回の決済注文が in-flight の間は<br/>再実行を拒否（二重発注防止をブローカー仕様に外注しない）

    UC-->>ES: EmergencyCloseAllResult（total / closed / errors / unresolved）
    ES-->>CL: 200 OK
```

## 建玉同期（実装済み: SyncPositionsUseCase）

> 実装: `application/SyncPositionsUseCase.ts`（Issue #52 Step 1）
> 呼び出し元は POST /api/sync（手動）と main.ts の定期 sync（1 分間隔）の 2 つ。同一の UseCase を共有する。

```mermaid
sequenceDiagram
    participant CL as Client(フロントエンド) / 定期sync(main.ts)
    participant ES as ExpressServer
    participant UC as SyncPositionsUseCase
    participant B as Broker
    participant PR as PositionRepository

    Note right of ES: HTTPサーバー：<br/>リクエストを受けてUseCaseを呼ぶだけ

    Note right of UC: UseCase層：<br/>ブローカー建玉とDBの不一致を検出・修正

    CL->>ES: POST /api/sync
    ES->>UC: execute()

    UC->>PR: openPositions()
    PR-->>UC: DB上のOpenPositions（forPairで対象ペアに射影）

    UC->>B: fetchOpenPositionIds(pair)
    B-->>UC: ブローカー建玉のPositionId一覧

    Note over UC: 順序は不変条件：DB読み取り→ブローカー照会。<br/>逆順だと照会後に約定した新規ポジションを<br/>「ブローカー不在」と誤判定して CLOSED 化する

    Note over UC: 片方向同期：<br/>OpenPositions.missingFrom(brokerIds) で<br/>外部決済済みポジションを抽出 → CLOSED更新

    loop ブローカーに存在しないDBポジション
        UC->>PR: markClosed(id)
        Note over PR: WHERE status='OPEN' ガード付き。<br/>通常決済フローと競合しても約定記録を上書きしない
        PR-->>UC: 完了
    end

    UC-->>ES: SyncPositionsResult（dbOpen / brokerOpen / synced）
    ES-->>CL: 200 OK
```

### 設計意図

- ExpressServerはリクエストを受けてUseCaseを呼ぶだけ。ビジネスロジックを一切持たない
- 増田亨レビューで指摘された依存方向違反を解消。ExpressServerがGmoRestClientを直接呼ぶ構造から、UseCase → Broker(Port) という正しい依存方向に修正
- UseCaseはBroker（Port interface）にだけ依存する。外部APIの存在を知らない

### 現実装の制約と改善項目

- CLOSED 更新は個別実行 + 失敗時 fail-fast（トランザクション一括ではない）。markClosed の失敗は DB 系統障害の可能性が高く、握り潰して続行すると障害を隠すため即座にエラー伝播する。未処理分は次回 sync（1 分間隔）の再試行で収束する
- 同期は片方向のみ（DB → CLOSED 更新）。ブローカーにあってDBにない建玉の登録、両方にある建玉の最新化は未実装（手動取引は管理対象外のため現状は仕様）
- `PositionRepository.markClosed(id)` はドメインの `Position.close()` を経由しないステータス更新。決済価格・損益（ExitResult）が取得できないための暫定措置で、ブローカーの約定履歴から ExitResult を復元してドメイン経由に変更するのが改善項目
