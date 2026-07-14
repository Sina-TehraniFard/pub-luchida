# テスト戦略

> このシステムのテストの基本方針:
> - 判定ロジック（Rule層）はテストを先に書いてから実装する
> - 外部APIとの接続部分は実装後に動作確認する
> - 本物の注文APIを呼ばないための「偽物クラス」はBrokerだけ用意する

---

## 1. なぜテストが書きやすいのか

このシステムの一番大事なロジック（エントリールールロジック）は、
テストするのに外部のAPIもDBも必要ない。

なぜかというと、Ruleは「市場の断面写真（MarketSnapshot）」を受け取るだけで、
GMO APIがどんな形のデータを返すかを知らないから。
テストの中でその「断面写真」を自分で作ってRuleに渡せばいい。

```typescript
// APIもDBも接続しなくていい。テストデータを直接作るだけ
const snapshot = new MarketSnapshot({
  timeFrames: {
    ONE_MINUTE: new TimeFrameSnapshot({
      indicators: new IndicatorValues({
        confirmed: new SmaSnapshot({
          shortSma:         new SmaValue(150.5),  // 今回: 短期が長期の上
          longSma:          new SmaValue(150.0),
          previousShortSma: new SmaValue(149.8),  // 前回: 短期が長期の下
          previousLongSma:  new SmaValue(150.1),
        })
      })
    })
  }
})

const result = rule.shouldEntry(snapshot)
expect(result).toBeInstanceOf(EntryCommand)  // ゴールデンクロスを検知できた
```

---

## 2. テストの3種類

| 種類 | 何をテストするか | いつ書くか | 自動実行 |
|------|-----------------|-----------|---------|
| **単体テスト** | Rule・ローソク足の組み立て・SMA計算など、部品1つ1つ | 実装より先に書く | コミットのたびに |
| **結合テスト** | TimeFrameBook・TradingSessionなど、部品を組み合わせた動き | 実装後に書く | コミットのたびに |
| **接続テスト** | 外部FX APIへの実際の接続・データ取得 | 実装後に書く | 手動（APIキーが必要なため） |

注文APIだけは「本物を呼ぶわけにいかない」ので、偽物のクラスを用意して使う（後述）。

---

## 3. 判定ロジックはテストを先に書く（Rule / CandleAccumulator / IndicatorLedger）

### なぜ先に書くのか

先にテストを書くと、「このロジックが何をすべきか」が明確になる。
実装してからテストを書くと、「テストが実装に合わせた形」になりやすく、
本当に正しいかどうかの確認にならない。

### 手順

```
① まず失敗するテストを書く（まだ実装がないので当然失敗する）
② テストが通る最小限のコードを書く
③ コードを整理する（テストが通ったままであることを確認しながら）
```

### SMAクロス判定のテスト例

```typescript
describe('SmaCrossEntryRule', () => {

  describe('ゴールデンクロス（短期が長期を上抜け）', () => {
    it('前回は短期が下にいて、今回は上に来た → エントリー命令を返す', () => {
      const snapshot = buildSnapshot({
        shortSma: 150.5, longSma: 150.0,          // 今回: 短期が上
        previousShortSma: 149.8, previousLongSma: 150.1  // 前回: 短期が下
      })
      expect(rule.shouldEntry(snapshot)).toBeInstanceOf(EntryCommand)
    })
  })

  describe('クロスなし', () => {
    it('短期がずっと長期の上にいる → 何もしない', () => {
      const snapshot = buildSnapshot({
        shortSma: 150.5, longSma: 150.0,
        previousShortSma: 150.3, previousLongSma: 150.0  // 前回も上にいた
      })
      expect(rule.shouldEntry(snapshot)).toBeInstanceOf(DoNothing)
    })
  })

  describe('デッドクロス（エントリーしない）', () => {
    it('短期が長期を下抜け → 何もしない', () => {
      const snapshot = buildSnapshot({
        shortSma: 149.8, longSma: 150.1,
        previousShortSma: 150.3, previousLongSma: 150.0
      })
      expect(rule.shouldEntry(snapshot)).toBeInstanceOf(DoNothing)
    })
  })
})
```

テストデータは `buildSnapshot()` というヘルパー関数でまとめて作る。
毎回ゼロから書くと長くなるため。

### ローソク足の組み立てテスト例

```typescript
describe('CandleAccumulator', () => {

  describe('足の組み立て', () => {
    it('14:03:27 のtickは 14:03 の足に属する', () => {
      const acc = new CandleAccumulator(TimeFrame.ONE_MINUTE)
      const event = acc.accumulate(tick('14:03:27', ask(150.0)))
      expect(event).toBeInstanceOf(CandleUpdated)
      expect(event.candle.openTime).toEqual(candleOpenTime('14:03:00'))
    })

    it('14:04:00 のtickが来たら 14:03 の足が確定する', () => {
      const acc = new CandleAccumulator(TimeFrame.ONE_MINUTE)
      acc.accumulate(tick('14:03:27', ask(150.0)))
      const event = acc.accumulate(tick('14:04:00', ask(150.2)))
      expect(event).toBeInstanceOf(CandleConfirmed)
      expect(event.confirmed.closeTime).toEqual(candleCloseTime('14:03:59'))
    })
  })

  describe('高値・安値の更新', () => {
    it('その足の中で一番高い価格が High に記録される', () => {
      const acc = new CandleAccumulator(TimeFrame.ONE_MINUTE)
      acc.accumulate(tick('14:03:10', ask(150.0)))
      acc.accumulate(tick('14:03:20', ask(151.5)))  // ここが一番高い
      acc.accumulate(tick('14:03:30', ask(150.8)))
      const event = acc.accumulate(tick('14:03:40', ask(150.3)))
      expect(event.candle.high).toEqual(price(151.5))
    })
  })
})
```

---

## 4. 組み合わせテスト（TimeFrameBook / TradingSession）

### TimeFrameBook のテスト

複数の時間足（1分足・1時間足・日足）にtickを渡して、
断面写真（MarketSnapshot）が正しく組み立てられるかを確認する。

```typescript
describe('TimeFrameBook', () => {
  it('tickが来たら MarketSnapshot を返す', async () => {
    const book = new TimeFrameBook([TimeFrame.ONE_MINUTE])
    await book.initialize(CurrencyPair.USD_JPY, stubbedCandleHistoryPort)

    const snapshot = book.onTick(tick('14:03:27', ask(150.0)))

    expect(snapshot).toBeInstanceOf(MarketSnapshot)
    expect(snapshot.timeFrames.get(TimeFrame.ONE_MINUTE)).toBeDefined()
  })
})
```

`stubbedCandleHistoryPort` は過去のローソク足データを返す最小限の代替クラス。
モックライブラリは使わず、TypeScriptのクラスをシンプルに書くだけ。

### TradingSession のテスト

市場データが届いたとき、RuleがエントリーOKと判定したらUIにシグナル検知が通知されるかを確認する。

```typescript
describe('TradingSession', () => {
  it('RuleがエントリーOKを出したらUIにシグナル検知を通知する', () => {
    const stubEntryRule = { shouldEntry: () => new EntryCommand(...) }
    const spyUiNotifier = { notifyEntryButton: vi.fn() }

    const session = new TradingSession({
      entryRules: [stubEntryRule],
      // ... 他の部品
    })

    session.onMarketData(anySnapshot())

    expect(spyUiNotifier.notifyEntryButton).toHaveBeenCalledOnce()
  })
})
```

---

## 5. 外部APIとの接続テスト

実際のFX APIに接続して、データが正しく取得・変換できているかを確認する。
APIキーが必要なため、自動実行はせず開発時に手動で実行する。

```typescript
// adapter/gmo/__tests__/GmoCandleHistoryAdapter.integration.test.ts
describe('GmoCandleHistoryAdapter（実API接続）', () => {
  it('USD_JPY の1分足を100本取得できる', async () => {
    const adapter = new GmoCandleHistoryAdapter(realApiClient)
    const candles = await adapter.fetchCandles(
      CurrencyPair.USD_JPY,
      TimeFrame.ONE_MINUTE,
      100
    )
    expect(candles).toHaveLength(100)
    expect(candles[0]).toBeInstanceOf(ConfirmedCandle)
  })
})
```

---

## 6. 注文APIだけは偽物クラスを用意する

テスト中に本物の注文APIを呼ぶと、実際に発注されてしまう。
そのためBrokerだけは「注文を出したふりをする偽物クラス」を用意してテストに使う。

```typescript
class StubBroker implements Broker {
  placedOrders: EntryCommand[] = []

  placeEntry(command: EntryCommand): EntryResult {
    this.placedOrders.push(command)  // 実際には注文しない。記録だけする
    return new EntryResult({ orderId: 'stub-001', status: 'FILLED' })
  }

  placeExit(command: ExitCommand): ExitResult {
    return new ExitResult({ status: 'FILLED' })
  }
}

describe('EntryExecution', () => {
  it('エントリー命令を受け取ったら注文APIを1回呼ぶ', () => {
    const broker = new StubBroker()
    const execution = new EntryExecution(broker, positionRepository)

    execution.openPosition(new EntryCommand(...))

    expect(broker.placedOrders).toHaveLength(1)
  })
})
```

複雑な設定が必要なモックライブラリは使わない。
シンプルなクラスを自前で書く方が、本番の動きとズレにくい。

---

## 7. テストフレームワーク

**Vitest** を使う。Javaで使われるJUnitと書き方が似ている。ESMネイティブで高速。

| JUnit | Vitest |
|-------|------|
| `@Test` | `it('...', () => {})` |
| `assertEquals` | `expect(x).toBe(y)` |
| `assertInstanceOf` | `expect(x).toBeInstanceOf(Y)` |
| `@BeforeEach` | `beforeEach(() => {})` |
| `@Nested` | `describe` のネスト |
| Mockito stub | 自前のTypeScriptクラス |

---

## 8. テストを書く順番

```
1. SmaValue, Price など小さな値クラス（一番シンプルなので最初に）
2. CandleAccumulator（テスト先行）--- ローソク足を組み立てるロジック
3. IndicatorLedger（テスト先行）  --- SMAを計算するロジック
4. SmaCrossEntryRule（テスト先行）--- 最も重要な判定ロジック
5. SmaCrossExitRule（テスト先行）
6. TimeFrameBook（実装後テスト）
7. EntryExecution / ExitExecution（偽物Brokerを使用）
8. TradingSession（実装後テスト）
9. 外部FX APIとの接続テスト（手動）
```
