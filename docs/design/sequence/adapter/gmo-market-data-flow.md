# シーケンス図: GMO市場データ取得フロー（Adapter層）

> 設計図ファイル（adapter-layer.drawio）に基づく。
> 上位フロー market-monitoring.md の MarketDataStream.start() を起点とし、
> Infrastructure層の具体的な通信手順を描く。

---

```mermaid
sequenceDiagram
    participant MDS as MarketDataStream
    participant GMA as GmoMarketDataAdapter
    participant GWS as GmoWebSocketClient
    participant GMO as GMO FX API(外部)

    Note right of MDS: Domain層：<br/>市場データの購読者。<br/>Adapterの存在を知らない

    Note right of GMA: MarketDataPort実装：<br/>WebSocket生データを<br/>値オブジェクトに変換する翻訳者

    Note right of GWS: WebSocket接続管理：<br/>接続維持とkeepaliveを担う

    MDS->>GMA: subscribe(onTick): () => void
    Note right of MDS: MarketDataPort経由で呼び出す。<br/>MDSはGmoMarketDataAdapterを直接知らない

    Note over GMA,GWS: WebSocket接続確立
    GMA->>GWS: connect()
    GWS->>GMO: WebSocket接続要求<br/>wss://forex-api.coin.z.com/ws/public/v1
    GMO-->>GWS: 接続確立

    GWS->>GMO: subscribe(ticker, USD_JPY)
    GMO-->>GWS: 購読開始確認

    loop 市場データ配信（市場オープン中は継続）
        GMO->>GWS: ticker data<br/>(ask, bid, timestamp, status)
        GWS->>GMA: onMessage callback(生データ)

        Note over GMA: 値オブジェクト変換：<br/>string → AskPrice, BidPrice,<br/>Timestamp, MarketStatus<br/>→ Tick生成

        GMA->>MDS: Tick（コールバック通知）

        Note over MDS: ここから先は<br/>tick-to-rule-overview.md の<br/>通常運用フローに続く。<br/>MDSはtickをTimeFrameBookに渡し<br/>MarketSnapshotを受け取る
    end

    loop サーバ ping 監視（市場オープン中、定期的に発生）
        GMO->>GWS: ping（1分に1回）
        Note over GWS: lastServerPingAt を更新<br/>（pong は ws ライブラリが自動応答）
    end

    alt 接続断（サーバ ping 180秒無受信）
        Note over GWS: 最終 ping 受信から180秒経過<br/>接続が死んだと判断し切断

        GWS->>GWS: scheduleReconnect()
        Note over GWS: 指数バックオフ（間隔上限5分）<br/>回数上限なし・接続確立まで再試行し続ける

        GWS->>GMO: WebSocket再接続要求
        GMO-->>GWS: 接続確立

        GWS->>GMO: subscribe(ticker, USD_JPY)
        GMO-->>GWS: 購読開始確認

        Note over GWS,GMA: 再接続完了。<br/>市場データ配信が再開される
    end
```

### 設計意図

- **MarketDataStreamは薄いブリッジ。** MarketDataPort経由でtickを受信し、TimeFrameBookに渡してMarketSnapshotを受け取り、listenerに通知するだけ。Adapterの存在もtickの加工方法も知らない
- **GmoMarketDataAdapterは翻訳者。** WebSocketから届く生のJSON文字列を、ドメインの値オブジェクト（AskPrice, BidPrice, Tick）に変換する。この変換がAdapter層の本質的な責務
- **GmoWebSocketClientは接続管理の専門家。** 接続確立、keepalive、自動再接続という通信インフラの関心事を引き受ける。GmoMarketDataAdapterは通信の詳細を知らなくてよい
- **再接続はWebSocketClientの責務。** サーバ ping の180秒無受信で切断し、指数バックオフ（間隔上限5分）で自動再接続する。回数上限は設けない——無人常駐のため打ち切ると復旧させる主体がなく、tick が止まったまま稼働し続けることになる（#342）。上位層（MarketDataAdapter, MarketDataStream）は接続断を意識しない
- **コールバック通知でリアクティブに配信。** push型の市場データ配信をリスナーパターンで表現。購読者（MarketDataStream）は到着を待つだけ
