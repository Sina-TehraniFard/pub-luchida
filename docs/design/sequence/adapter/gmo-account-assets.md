# シーケンス図: GMO口座残高取得フロー（Adapter層）

> 上位フロー multi-strategy-entry.md の `PositionSizingService` が残高を必要とする場面から先の通信手順を描く。

---

```mermaid
sequenceDiagram
    participant PSS as PositionSizingService
    participant GBA as GmoBalanceAdapter
    participant GRC as GmoRestClient
    participant GMO as GMO FX API(外部)

    Note right of PSS: 呼び出し側：<br/>BalancePort 経由で<br/>現在残高（current）または<br/>鮮度保証残高（freshNow）を要求する

    Note right of GBA: Adapter層：<br/>5秒TTLのキャッシュは内部実装。<br/>GMO APIのレスポンスを<br/>ドメインの値オブジェクト（Balance）に変換する。<br/>Adapter自身はフォールバック値を持たない

    Note right of GRC: HTTP通信担当：<br/>署名生成とリクエスト送信

    PSS->>GBA: current() または freshNow()

    alt キャッシュヒット（5秒以内の取得済みデータあり）
        GBA-->>PSS: Balance（キャッシュから返却）
    else キャッシュミス
        GBA->>GRC: get("/private/v1/account/assets")

        Note over GRC: HMAC-SHA256署名生成：<br/>timestamp + GET + /v1/account/assets<br/>→ API-SIGN

        GRC->>GMO: GET /private/v1/account/assets<br/>Headers: API-KEY, API-TIMESTAMP, API-SIGN

        alt API正常応答
            GMO-->>GRC: { status: 0, data: { balance, ... } }
            GRC-->>GBA: Response

            Note over GBA: 値オブジェクト変換：<br/>balance(string) → Balance<br/>※ availableAmount は Step5 範囲外

            GBA-->>PSS: Balance（純残高）
            Note over GBA: 内部キャッシュに保存（TTL: 5秒）
        else API障害（タイムアウト、5xx等）
            GMO-->>GRC: エラー
            GRC-->>GBA: エラー

            alt current() 経路（鮮度非保証）
                Note over GBA: Adapter は null を返す。<br/>フォールバック値は持たない
                GBA-->>PSS: null
                Note over PSS: PositionSizingService が<br/>?? fallbackBalance で吸収する<br/>（fallbackBalance は main.ts で<br/>Balance.of(Money.jpy(...)) として注入）
            else freshNow() 経路（鮮度保証）
                Note over GBA: Adapter は throw する。<br/>フォールバックしない（古い残高で発注しない）
                GBA-->>PSS: throw
                Note over PSS: PositionSizingService は<br/>発注を中止する
            end
        end
    end
```

## 設計意図

- 5秒TTLのキャッシュでAPI呼び出しを最小化する。tickごとに残高APIを叩くと即座にレート制限に引っかかる。キャッシュは Adapter 内部実装で、クラス名・上位 Port 契約には出さない
- API障害時に Adapter 自身は null（current）または throw（freshNow）で正直に失敗を伝える。CAPITAL のような環境変数フォールバックは Adapter 層に持ち込まない
- フォールバック値（`fallbackBalance: Balance`）は `main.ts` で `Balance.of(Money.jpy(...))` として値オブジェクト化し、`PositionSizingService` のコンストラクタに注入する（policies.md 1.7 / 1.10.3 と整合）
- `PositionSizingService` は `BalancePort`（interface）にだけ依存する。キャッシュの有無や外部 API の存在を知らない
- 値オブジェクト変換は Adapter 層の中で完結する。string 型のレスポンスがドメイン層に漏れ出すことはない

## Step5 範囲外の事項（Note）

- 本シーケンスでは `balance` フィールドのみを返す経路を描いている。GMO API レスポンスの `availableAmount`（含み損益込み利用可能残高）を使った**利用可能残高ベースの上限チェックは Step5 範囲外**であり、`EntryQueue` 完成後（Step6 以降）の別 issue で対応する
- `BalancePort.availableAmount(): AvailableBalance` の追加、および `PositionManager` 側での `availableBalance = balance - usedMargin - pendingMargin` の組み立ては別 issue（policies.md 1.6 / brief.md 5.1 R5 参照）
