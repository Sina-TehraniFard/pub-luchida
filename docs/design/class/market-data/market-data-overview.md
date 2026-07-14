# 市場データ加工層 クラス図 概説

> 4つのクラス図を読むためのガイド。
> 「なぜこの設計なのか」「各クラスがどう連携するのか」を説明します。

---

## 1. この層の役割

取引所から届く価格データは「今この瞬間 150.123円」というただの数字です。
Ruleが「今エントリーすべきか」を判断するには、それだけでは足りません。

- 直近の値動きの形（ローソク足）
- 平均的な価格の流れ（SMA）
- 「さっきと比べて上に抜けたかどうか」（前回値との比較）

これらが揃って初めて、Ruleは判定できます。

**この層の仕事は、生の数字をRuleが使える形に加工して渡すことです。**

```
生の数字（tick）  →  [この層が加工]  →  断面写真（MarketSnapshot）  →  Rule
```

---

## 2. 全体の流れ

具体例で追いかけます。

14:03:27に「ドル円 150.123円（売値）」というtickが届きました。
このtickは **TimeFrameBook（時間足帳簿）** に渡されます。

帳簿の中では、1分足・1時間足・日足それぞれに対して以下の2ステップが実行されます。

**ステップ1: ローソク足を更新する（CandleAccumulator）**

「14:03:27のtickは、14:03の1分足に属する」と判定して足を更新します。
もし次の時間帯（14:04:00）のtickが届いたら、14:03の足を「確定」させます。

**ステップ2: SMAを更新する（IndicatorLedger）**

足が更新されたことをもとに、短期SMAと長期SMAを再計算します。
前回の値もあわせて記録しておきます（クロス判定に使うため）。

---

3つの時間枠すべての処理が終わったら、帳簿が **MarketSnapshot（断面写真）** を組み立てます。

```
tick到着
  → 1分足: ローソク足を更新 → SMAを更新
  → 1時間足: ローソク足を更新 → SMAを更新
  → 日足: ローソク足を更新 → SMAを更新
  → 全時間枠分の情報をまとめてMarketSnapshotを作成
  → Ruleに渡す
```

Ruleはこの断面写真だけを受け取って判定します。
足の作り方もSMAの計算方法も知らなくていい。

---

## 3. クラス図の読み方ガイド

1枚の図に全クラスを詰め込むと矢印が交差して読めなくなるため、4枚に分けています。
**以下の順番で読むことを推奨します。**

| 順 | 図 | ファイル | わかること |
|:--:|---|---|---|
| 1 | 足組立 | [market-data-candle.drawio](./market-data-candle.drawio) | tickからローソク足がどう作られるか。未確定足と確定足の関係 |
| 2 | 指標計算 | [market-data-indicator.drawio](./market-data-indicator.drawio) | SMA値がどう計算・保持されるか。前回値の保持 |
| 3 | 相場概況 | [market-data-snapshot.drawio](./market-data-snapshot.drawio) | Ruleに何が渡されるか。MarketSnapshotの構造 |
| 4 | 時間足帳簿 | [market-data-book.drawio](./market-data-book.drawio) | 複数の時間足をどう束ねて管理するか |

部品（足組立・指標計算・相場概況）を先に理解してから、
それらを束ねる帳簿を見ると全体像がつかみやすいです。

> 各クラス図の中に、他の図で定義されているクラスが灰色の枠で表示されている場合があります。
> それは「このクラスは別の図で詳しく説明しています」という印です。

---

## 4. 登場人物一覧

まず全員を一覧で確認します。

| クラス名 | 日本語名 | 一言 |
|---|---|---|
| TimeFrameBook | 時間足帳簿 | 全体の司令塔。tickを受け取り、最終的に断面写真を返す |
| CandleAccumulator | 足組立係 | tickからローソク足を作る。SMAは知らない |
| IndicatorLedger | 指標台帳 | SMAを計算・記録する。足の作り方は知らない |
| MarketSnapshot | 相場概況 | Ruleに渡す断面写真。計算はしない、持つだけ |
| TimeFrameSnapshot | 時間枠の断面 | 特定の時間枠（1分足など）の断面写真 |
| IndicatorValues | 指標値セット | 確定足ベース・形成中ベースのSMAをセットで持つ |
| SmaSnapshot | SMAの瞬間値 | 今回と前回のSMA値。クロス判定に使う |
| FormingCandle | 未確定足 | 現在作成中のローソク足。tickごとに更新される |
| ConfirmedCandle | 確定足 | 完成したローソク足。一度確定したら変わらない |

---

### TimeFrameBook（時間足帳簿）

**何をするか**
tickを受け取り、1分足・1時間足・日足の3つ全てに対して処理を実行する。
最終的にMarketSnapshot（相場概況）を組み立てて返す。

**コンストラクタ**
`constructor(pair: CurrencyPair, config: IndicatorConfig, factory: SmaCalculatorFactory)`
- `pair`: 対象通貨ペア
- `config`: SMA期間の設定（shortSmaPeriod, longSmaPeriod）
- `factory`: SmaCalculator の生成ファクトリ（DI）

**初期化**
`warmUp(timeFrame: TimeFrame, confirmedCandles: ConfirmedCandle[]): void`
- 時間足ごとに過去の確定足を流し込んでSMAを安定状態にする
- 呼び出し元（TradingSession等）がCandleHistoryPortから取得した確定足を渡す
- TimeFrameBook自身はCandleHistoryPortを知らない（依存しない）

**何を知らないか**
足の組み立て方やSMAの計算方法は知らない。
それぞれの専門家（CandleAccumulator、IndicatorLedger）に任せ、結果を受け取るだけ。
過去データの取得方法も知らない（呼び出し元がwarmUpで渡してくれる）。

---

### CandleAccumulator（足組立係）

**何をするか**
tickを受け取り、「このtickはどの足に属するか」を判定して、ローソク足を更新する。
新しい時間帯のtickが来たら、前の足を「確定」させて新しい足を開始する。

**返すもの**
- 足が更新された（CandleUpdated）
- 足が確定した（CandleConfirmed）

のどちらか。SMAの計算は関与しない。

---

### IndicatorLedger（指標台帳）

**何をするか**
足の情報をもとにSMAを計算し、現在値と前回値をセットで記録する。
- 足が確定したら → その足を記録に追加してSMAを再計算
- 未確定足が更新されたら → 仮の値として差し替えてSMAを再計算

**何を知らないか**
足の組み立て方は知らない。SMAの計算に必要な数値を受け取るだけ。
外部の計算ライブラリ（trading-signals）を使っているのはこのクラスだけ。

---

### MarketSnapshot（相場概況）

**何をするか**
Ruleに渡される「この瞬間の相場全体の断面写真」。
自分では何も計算しない。データを持つだけ。

**何が入っているか**
通貨ペア、取得時刻、各時間枠の断面写真（TimeFrameSnapshot）のセット。

---

### TimeFrameSnapshot（時間枠の断面写真）

特定の時間枠（例: 1時間足）のある瞬間を切り取ったものです。
以下の3点セットを持っています。

- 最新の確定足（ConfirmedCandle）
- 現在形成中の未確定足（FormingCandle）
- その時点のSMA値（IndicatorValues）

---

### IndicatorValues と SmaSnapshot

SMA値の入れ物です。2段構造になっています。

**IndicatorValues** — 2種類のSMA値をセットで持つ

| フィールド | 何か |
|---|---|
| `confirmed` | 確定足だけで計算したSMA。安定している |
| `forming` | 未確定足も含めて計算したSMA。tickごとに変わる |

**SmaSnapshot** — 1種類のSMAの「今回と前回」を持つ

| フィールド | 何か |
|---|---|
| `shortSma` | 今回の短期SMA |
| `longSma` | 今回の長期SMA |
| `previousShortSma` | 前回の短期SMA |
| `previousLongSma` | 前回の長期SMA |

前回値を持つのは、ゴールデンクロス判定（前回は下にいたが今回は上に来た）に使うため。

---

### FormingCandle（未確定足）

現在形成中のローソク足です。
tickが届くたびにHigh・Low・Closeが更新されます。

- `update(tick: Tick): CandleEvent` -- tickで足を更新し、CandleEvent（更新or確定）を返す
- `confirm(closeTime: CandleCloseTime): CandleEvent` -- 足を確定させてCandleEvent（CandleConfirmed）を返す
- `toConfirmed(closeTime: CandleCloseTime): ConfirmedCandle` -- 足をConfirmedCandleに変換する（confirmの内部で使用）

次の時間帯のtickが来たタイミングで確定足（ConfirmedCandle）に変換されます。

---

### ConfirmedCandle（確定足）

完成したローソク足です。
一度確定したら二度と変わりません。
Open・High・Low・Close・開始時刻・終了時刻を持っています。

---

## 4.5. 設定・計算インターフェース

### IndicatorConfig（指標設定）

SMA期間の設定を保持する値オブジェクト。

| フィールド | 型 | 説明 |
|---|---|---|
| `shortSmaPeriod` | `number` | 短期SMAの期間（例: 5） |
| `longSmaPeriod` | `number` | 長期SMAの期間（例: 25） |

制約: `shortSmaPeriod < longSmaPeriod`、両方とも正の整数。

---

### SmaCalculator（SMA計算 Portインターフェース）

SMA計算を抽象化したインターフェース。
実装はAdapter層で trading-signals ライブラリを使う。

| メソッド | 戻り値 | 説明 |
|---|---|---|
| `add(value: BigDecimal)` | `void` | 新しい値を追加してSMAを再計算 |
| `replace(value: BigDecimal)` | `void` | 最新の値を差し替えてSMAを再計算（未確定足の更新用） |
| `isStable()` | `boolean` | 十分なデータが蓄積され、SMA値が安定しているか |
| `getResult()` | `SmaValue` | 現在のSMA値を取得 |

---

### SmaCalculatorFactory（SmaCalculator生成ファクトリ）

SmaCalculatorを生成するファクトリインターフェース。
TimeFrameBookのコンストラクタにDIで注入する。

| メソッド | 戻り値 | 説明 |
|---|---|---|
| `create(period: number)` | `SmaCalculator` | 指定期間のSmaCalculatorを生成 |

---

## 5. 値オブジェクト一覧

| 名前 | 説明 |
|---|---|
| Tick | 瞬間価格。ask・bid・タイムスタンプの3点セット。取引所から届く生データの最小単位 |
| Price | 価格の値。浮動小数点の誤差を排除するためBigDecimalで保持する |
| SmaValue | SMAの計算結果の値。BigDecimalで保持する |
| TimeFrame | 時間枠の種別。1分足・1時間足・日足の3種（固定トリオ） |
| TickTimestamp | tickが発生した瞬間のタイムスタンプ |
| CandleOpenTime | ローソク足の開始時刻。例: 1分足なら14:03:00 |
| CandleCloseTime | ローソク足の終了時刻。例: 1分足なら14:03:59。確定足のみが持つ |
| CurrencyPair | 通貨ペア。例: USD_JPY（ドル円） |

---

## 6. 設計判断の記録

### なぜ足組立係と指標台帳を分けたのか

足の組み立てと指標の計算は、**変更の理由が異なります**。

足組立係が変わるのは「足の組み立てルールが変わったとき」です（例: 平均足を導入）。
指標台帳が変わるのは「計算する指標が増えたとき」です（例: RSIやMACDを追加）。

1つのクラスに押し込めると、片方を変えたときにもう片方が壊れるリスクが生まれます。
分けておけば、RSIを追加するとき指標台帳だけを修正すればよく、足組立係には触れません。

---

### なぜMarketSnapshotに前回SMA値も含めるのか

Ruleは「渡された断面写真だけを見て判定できる」状態であるべきです。
同じsnapshotを渡せば必ず同じ結果が返る。これがテスト容易性の根拠です。

ゴールデンクロスを検知するには「前回のSMA値」と「今回のSMA値」の両方が必要です。
もしRuleが前回値を自分で覚えていたら、テストのたびに「前回の状態をセットアップする」手間が増えます。

前回値をMarketSnapshotに含めることで、Ruleは1枚の断面写真だけで判定できます。

---

### なぜIndicatorValuesをconfirmed/formingに分けたのか

確定足ベースで安定して判定したいルールもあれば、
tickベースで瞬時に反応したいルールもあります。

「ルールは必ず確定足だけを見る」と決めてしまうと、後者のルールが実装できなくなります。
confirmed / forming に分けることで、両方のルールが同じ仕組みで実装できます。

---

### なぜObservable型をやめてコールバック型にしたのか

当初、MarketDataPortのインターフェースは `priceStream(): Observable<MarketData>` でした。
ObservableはRxJSというライブラリの型です。

ドメインとインフラの境界にRxJSの型が現れると、ドメイン層がRxJSに依存してしまいます。
将来RxJSをやめたくなったとき、境界ごと書き換えなければなりません。

コールバック型 `subscribe(listener): Subscription` にすることで、
RxJSを使うかどうかはAdapter層（インフラ側）の判断に閉じ込められます。

---

## 7. 未決定事項

| 項目 | 状態 |
|---|---|
| Ruleはtickごとに呼ばれるのか、足確定時だけ呼ばれるのか | **決定済み**: tickごとに呼ぶ |
| 時間足帳簿が管理する時間足の種類は誰が決めるか（設定ファイル vs Rule自身の宣言） | 未決定 |
| クロス判定は相場概況に含めるか | 現時点ではRule側の責務とする方針 |
| KLines APIのデータ取得失敗時のリカバリ | **決定済み**: 「指標計算可能状態」というドメイン概念で表現する |
| MarketDataStreamの責務肥大化への対処 | **決定済み**: TimeFrameBook.onTick(tick)に委譲。MDSは薄いブリッジ |
