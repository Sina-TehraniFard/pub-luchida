# 値オブジェクト設計書

> 設計方針: プリミティブ型を使うな。ドメインの概念を型にしろ。

---

## 1. 値オブジェクトとは

ドメインの概念を型で表現したものです。`string`や`number`の代わりに使います。
等価性はIDではなく値そのもので判定します。一度作ったら変更できません（不変）。
「通貨ペア」を`string`で扱った瞬間、それはもうドメインモデルではありません。ただの文字列処理です。

---

## 2. 設計方針

### プリミティブ型を使わない

`string`、`number`、`boolean`をドメイン層で直接使うことを禁止します。
「価格」は`number`ではなく`Price`です。「通貨ペア」は`string`ではなく`CurrencyPair`です。

### 生成時にバリデーション

不正な値は存在できません。`Price.of(-100)`は例外を投げます。
コンストラクタを`private`にし、`static factory method`で生成します。
バリデーションを通過したものだけがインスタンスになれます。

### 不変（イミュータブル）

一度作った値オブジェクトは変更できません。
「価格を変える」のではなく「新しい価格を作る」です。

### 等価比較は値で行う

`==`（参照比較）ではなく`equals()`（値比較）を使います。
`Price.of(100.5).equals(Price.of(100.5))`は`true`です。

### TypeScriptでの実装パターン

`class` + `private constructor` + `static factory method` が基本形です。
詳しくは「5. TypeScript実装ノート」を参照してください。

---

## 3. 値オブジェクト一覧

---

### 取引関連

---

#### CurrencyPair（通貨ペア）

- **意味**: 売買対象の通貨の組み合わせ。GMO FX API の `symbol` 値に対応します
- **型の内部表現**: TS では **branded string**（`AnyPair & { __brand: 'CurrencyPair' }`）。`AnyPair = ${Currency}_${Currency}` のテンプレートリテラル型で「`Currency` 型に登録されていない通貨が混入する」事故をコンパイル時に防ぎます
- **制約**: ビジネスとして取引対象の 14 ペアのみホワイトリストで許容。存在しない通貨ペアは生成不可
- **使用箇所**: Tick, ConfirmedCandle, FormingCandle, EntryCommand, MarketSnapshot, TimeFrameBook, LotDecisionInput, Rate
- **公開 API（PR #137 で追加 / `domain/market/CurrencyPair.ts` から module-level 関数として export）**:
  - `base(pair: CurrencyPair): Currency` — 命名規則 BASE_QUOTE の左側
  - `quote(pair: CurrencyPair): Currency` — 命名規則 BASE_QUOTE の右側。`Balance` の通貨と `Rate` の quote 整合チェックで利用
  - `pipUnit(pair: CurrencyPair): Big` — 1 pip の小数単位（JPY quote 0.01 / それ以外 0.0001）。設計憲法 6.1 に従い `Big` で返す
  - `currencyPairEquals(a, b): boolean` — 等価比較（`===` ベース）

**Note（branded string 採用の判断 / PR #137）**:
`CurrencyPair` は **演算を持たない識別子的な値**です。等価比較（`===`）と文字列としての保存・転送ができれば足り、`pair.plus(other)` のような演算は意味を持ちません。値オブジェクトの class 化は「演算を凝集させる」ための手段であり、識別子に対しては便益が薄いと判断しました。

棲み分けの基準:
- **演算を持たない識別子的 VO は branded string**: `CurrencyPair`, `StrategyName`, `Currency`（`Currency` は string literal union）
- **演算を持つ VO は class**: `Money`, `Balance`, `Rate`, `Lot`, `Pips`, `MaintenanceRatio`, `MarginRate` など

**型レベル防御の限界**:
`AnyPair = ${Currency}_${Currency}` は 11 × 11 = 121 通りを許容します。順序逆転（`JPY_USD`）や同一通貨ペア（`JPY_JPY`）はコンパイル時には弾けず、`CurrencyPair()` ファクトリの `BUSINESS_PAIRS.has(...)` で実行時に拒否します。型は「`Currency` 型に登録されていない 3 文字が混入する」事故だけを第一防衛線として防ぎます。同一ペア不存在の業務ルールは `Currency.test.ts` の「base ≠ quote」テストで宣言します。

**実運用への影響（branded string 採用後の実態調査 / PR #137 時点）**:
- `Map<CurrencyPair, X>` のキー利用: **0 箇所**（現状コードは `currencyPairEquals` ベースの線形探索）
- `currencyPairEquals(a, b)` の利用: **2 箇所**（`OpenPositions.hasPositionFor`, `MarketSnapshot.equals`）
- DB 保存: `varchar('currency_pair', { length: 7 })` に文字列としてそのまま保存（`positions` テーブル）。class 化しても `.toString()` 経由で同等だが、`PostgresPositionRepository` での復元時に `CurrencyPair(row.currencyPair)` で再バリデーションする境界処理は branded string の方が薄く済みます
- JSON シリアライズ: `JSON.stringify(pair)` は文字列リテラルとしてそのまま出力。API レスポンス・ログ出力で追加処理は不要

すなわち branded string は、現状コードベースでは **ゼロコスト** で識別子的 VO の役割を果たしています。

**（コード例は他 VO と異なり TypeScript で記載）**: 他 VO は Java で例示する規約ですが、`CurrencyPair` の branded string 表現は Java に直訳できないため TypeScript 例とします。

```typescript
// domain/market/Currency.ts
export type Currency =
  | 'JPY' | 'USD' | 'EUR' | 'GBP' | 'AUD'
  | 'NZD' | 'CAD' | 'CHF' | 'TRY' | 'ZAR' | 'MXN';

// domain/market/CurrencyPair.ts
type AnyPair = `${Currency}_${Currency}`;

const BUSINESS_PAIRS: ReadonlySet<AnyPair> = new Set<AnyPair>([
  'USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY',
  'NZD_JPY', 'CAD_JPY', 'CHF_JPY', 'TRY_JPY', 'ZAR_JPY', 'MXN_JPY',
  'EUR_USD', 'GBP_USD', 'AUD_USD', 'NZD_USD',
]);

export type CurrencyPair = AnyPair & { readonly __brand: 'CurrencyPair' };

export function CurrencyPair(value: string): CurrencyPair {
  if (!BUSINESS_PAIRS.has(value as AnyPair)) {
    throw new Error(`未対応の通貨ペア: ${value}`);
  }
  return value as CurrencyPair;
}

export function base(pair: CurrencyPair): Currency {
  // BUSINESS_PAIRS 通過後は必ず Currency_Currency 形式 (テンプレートリテラル型より) のため as キャスト
  return pair.slice(0, 3) as Currency;
}

export function quote(pair: CurrencyPair): Currency {
  return pair.slice(-3) as Currency;
}

const PIP_UNIT_JPY_QUOTE: Big = new Big('0.01');
const PIP_UNIT_NON_JPY_QUOTE: Big = new Big('0.0001');

export function pipUnit(pair: CurrencyPair): Big {
  return quote(pair) === 'JPY' ? PIP_UNIT_JPY_QUOTE : PIP_UNIT_NON_JPY_QUOTE;
}
```

**旧ヘルパ（`@deprecated` / Step 11 で削除予定）**:
- `isJpyQuote(pair)` → `quote(pair) === 'JPY'` で代替
- `resolvePipUnit(pair): number`（`PipUnit.ts`） → `pipUnit(pair): Big` で代替（`number` リテラルでの端数誤差を避ける）
- 削除手順と検収条件は `position-manager/policies.md` 4.3 Step 11 詳細を参照

---

#### BuySell（売買区分）

- **意味**: 買い（BUY）か売り（SELL）かを表す区分です
- **型の内部表現**: enum
- **制約**: BUYまたはSELLの2値のみ
- **使用箇所**: EntryCommand, Position

```java
public enum BuySell {
    BUY, SELL;

    public BuySell opposite() {
        return this == BUY ? SELL : BUY;
    }
}
```

---

#### Lot（取引数量）

- **意味**: 取引する通貨の数量です。GMO FXでは1Lot = 1万通貨単位
- **型の内部表現**: `int`（Lot数）
- **制約**: 100以上500,000以下。100の倍数のみ（GMO FXの取引単位に準拠）
- **使用箇所**: EntryCommand

```java
public class Lot {
    private final int value;

    private Lot(int value) { this.value = value; }

    public static Lot of(int value) {
        if (value < 100 || value > 500_000 || value % 100 != 0) {
            throw new IllegalArgumentException(
                "Lotは100以上500,000以下の100の倍数: " + value);
        }
        return new Lot(value);
    }

    public int toInt() { return value; }
}
```

---

#### PositionId

- **意味**: 建玉（ポジション）を一意に識別するIDです
- **型の内部表現**: `UUID`
- **制約**: UUID形式。生成はファクトリメソッドで行います
- **使用箇所**: Position, ExitCommand, EntryResult

```java
public class PositionId {
    private final UUID value;

    private PositionId(UUID value) { this.value = value; }

    public static PositionId generate() {
        return new PositionId(UUID.randomUUID());
    }

    public static PositionId from(String value) {
        return new PositionId(UUID.fromString(value));
    }
}
```

---

### 価格関連

---

#### Price（価格）

- **意味**: 通貨の価格です。askやbid、約定価格などに使います
- **型の内部表現**: `BigDecimal`
- **制約**: 正の数のみ。小数点以下の桁数は通貨ペアに依存します（USD_JPYは3桁、EUR_USDは5桁）
- **使用箇所**: Tick, ConfirmedCandle, FormingCandle, EntryResult, ExitResult

```java
public class Price {
    private final BigDecimal value;

    private Price(BigDecimal value) { this.value = value; }

    public static Price of(BigDecimal value) {
        if (value.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException(
                "価格は正の数: " + value);
        }
        return new Price(value);
    }

    public static Price of(String value) {
        return of(new BigDecimal(value));
    }

    public Price minus(Price other) {
        return new Price(this.value.subtract(other.value));
    }

    public BigDecimal toBigDecimal() { return value; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Price other)) return false;
        return value.compareTo(other.value) == 0;
    }

    @Override
    public int hashCode() { return value.stripTrailingZeros().hashCode(); }

    @Override
    public String toString() { return value.toPlainString(); }
}
```

---

#### Pips（値幅）

- **意味**: 価格の変動幅を表す単位です。損益の表現にも使います
- **型の内部表現**: `BigDecimal`
- **制約**: 正負あり（利益が正、損失が負）。クロス円の場合、1pip = 0.01
- **使用箇所**: ExitResult（損益計算）, Rule内部での閾値比較

```java
public class Pips {
    private final BigDecimal value;

    private Pips(BigDecimal value) { this.value = value; }

    public static Pips of(BigDecimal value) {
        return new Pips(value);
    }

    public boolean isPositive() {
        return value.compareTo(BigDecimal.ZERO) > 0;
    }

    public boolean isGreaterThan(Pips other) {
        return this.value.compareTo(other.value) > 0;
    }
}
```

---

#### Spread（スプレッド）

- **意味**: ask価格とbid価格の差です。取引コストに相当します
- **型の内部表現**: `Price`(ask) + `Price`(bid)
- **制約**: 常にask > bid。ゼロは許容しません
- **使用箇所**: Tickから算出、Ruleでのスプレッドフィルタ

```java
public class Spread {
    private final Price ask;
    private final Price bid;

    private Spread(Price ask, Price bid) {
        this.ask = ask;
        this.bid = bid;
    }

    public static Spread of(Price ask, Price bid) {
        BigDecimal diff = ask.toBigDecimal()
            .subtract(bid.toBigDecimal());
        if (diff.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException(
                "スプレッドは正の数: ask=" + ask + ", bid=" + bid);
        }
        return new Spread(ask, bid);
    }

    public Pips value() {
        BigDecimal diff = ask.toBigDecimal()
            .subtract(bid.toBigDecimal());
        return Pips.of(diff);
    }
}
```

---

### 時間関連

---

#### TickTimestamp

- **意味**: tickが発生した瞬間を表す時刻です。ミリ秒精度
- **型の内部表現**: `Instant`
- **制約**: 未来の時刻は許可しません
- **使用箇所**: Tick

```java
public class TickTimestamp {
    private final Instant value;

    private TickTimestamp(Instant value) { this.value = value; }

    public static TickTimestamp of(Instant value) {
        return new TickTimestamp(value);
    }

    public Instant toInstant() { return value; }
}
```

---

#### CandleOpenTime

- **意味**: ローソク足の開始時刻です
- **型の内部表現**: `Instant`
- **制約**: 時間足種別に応じた切り捨て（1分足なら秒以下がゼロ）
- **使用箇所**: FormingCandle, ConfirmedCandle

---

#### CandleCloseTime

- **意味**: ローソク足の終了時刻です。確定足のみが持ちます
- **型の内部表現**: `Instant`
- **制約**: 対応するCandleOpenTimeより後の時刻であること
- **使用箇所**: ConfirmedCandle

---

#### Timestamp

- **意味**: 汎用的なタイムスタンプです。イベント発生時刻の記録に使います
- **型の内部表現**: `Instant`
- **制約**: なし（過去・現在を問わない）
- **使用箇所**: EntryResult, ExitResult（executedAt）

---

### 市場データ関連

---

#### Tick

- **意味**: ある瞬間の市場価格です。ask（買値）、bid（売値）、発生時刻の3つ組。最も基本的な市場データです
- **型の内部表現**: `Price`(ask) + `Price`(bid) + `TickTimestamp`
- **制約**: ask > bid（askがbidより大きい）。3つ全てが必須
- **使用箇所**: MarketDataStream, CandleAccumulator, MarketSnapshot

```java
public class Tick {
    private final Price ask;
    private final Price bid;
    private final TickTimestamp timestamp;

    private Tick(Price ask, Price bid, TickTimestamp timestamp) {
        this.ask = ask;
        this.bid = bid;
        this.timestamp = timestamp;
    }

    public static Tick of(Price ask, Price bid,
                          TickTimestamp timestamp) {
        if (ask.toBigDecimal().compareTo(
                bid.toBigDecimal()) <= 0) {
            throw new IllegalArgumentException(
                "ask > bid必須: ask=" + ask + ", bid=" + bid);
        }
        return new Tick(ask, bid, timestamp);
    }

    public Spread spread() {
        return Spread.between(ask, bid);
    }

    public Price midPrice() {
        BigDecimal mid = ask.toBigDecimal()
            .add(bid.toBigDecimal())
            .divide(BigDecimal.valueOf(2), RoundingMode.HALF_UP);
        return Price.of(mid);
    }

    public Price ask() { return ask; }
    public Price bid() { return bid; }
    public TickTimestamp timestamp() { return timestamp; }
}
```

---

#### TimeFrame（時間足種別）

- **意味**: ローソク足の時間単位を表します
- **型の内部表現**: enum
- **制約**: ONE_MINUTE / FIFTEEN_MINUTE / ONE_HOUR / ONE_DAY の4種。追加はenum拡張で行う
- **使用箇所**: TimeFrameBook, CandleAccumulator, ConfirmedCandle, FormingCandle, MarketSnapshot

```java
public enum TimeFrame {
    ONE_MINUTE(Duration.ofMinutes(1)),
    FIFTEEN_MINUTE(Duration.ofMinutes(15)),
    ONE_HOUR(Duration.ofHours(1)),
    ONE_DAY(Duration.ofDays(1));

    private final Duration duration;

    TimeFrame(Duration duration) {
        this.duration = duration;
    }

    public Duration duration() { return duration; }
    public String label() { return name(); }
}
```

---

#### SmaValue（SMA値）

- **意味**: 単純移動平均（Simple Moving Average）の計算結果です
- **型の内部表現**: `BigDecimal`
- **制約**: 正の数。計算期間（5, 25等）は別途保持しません（IndicatorLedgerが管理）
- **使用箇所**: IndicatorLedger, MarketSnapshot, Rule内部でのクロス判定

```java
public class SmaValue {
    private final BigDecimal value;

    private SmaValue(BigDecimal value) { this.value = value; }

    public static SmaValue of(BigDecimal value) {
        if (value.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException(
                "SMA値は正の数: " + value);
        }
        return new SmaValue(value);
    }

    public boolean isAbove(SmaValue other) {
        return this.value.compareTo(other.value) > 0;
    }
}
```

---

#### ConvictionScore（確信スコア）

- **意味**: エントリー条件の強さを0.0〜1.0で表したスコアです。luchida-rules（Ruleリポ）が計算します
- **型の内部表現**: `BigDecimal`
- **制約**: 0.0以上1.0以下。SMAスプレッドをATRで正規化し、ガウス関数で変換。逆U字形（広がりすぎも狭すぎも低スコア）
- **使用箇所**: EntryRule(生成), EntryCommand(含む), EntryExecution(position_entry_snapshotsに保存)

```java
public class ConvictionScore {
    private final BigDecimal value;

    private ConvictionScore(BigDecimal value) { this.value = value; }

    public static ConvictionScore of(BigDecimal atRatio) {
        // ガウス関数: exp(-((x - mu)^2) / (2 * sigma^2))
        // atRatioはSMAスプレッド/ATR。luchida-rulesがパラメータを管理する
        BigDecimal score = gaussianTransform(atRatio);
        return new ConvictionScore(score);
    }

    public boolean isHighEnough(ConvictionScore threshold) {
        return this.value.compareTo(threshold.value) >= 0;
    }

    public BigDecimal toBigDecimal() { return value; }
}
```

`isHighEnough(BigDecimal threshold)` ではなく `isHighEnough(ConvictionScore threshold)` とすることで、「スコアとスコアを比較する」という意図が型で表現されます。`SmaValue.isAbove(SmaValue other)` と同じパターンです。

---

#### FormingCandle（未確定足）

- **意味**: 現在形成中のローソク足です。tickが到着するたびにHigh/Low/Closeが更新されます
- **型の内部表現**: `Price`(open, high, low, close) + `CandleOpenTime` + `TimeFrame`
- **制約**: open/high/low/closeの整合性（high >= open, high >= close, low <= open, low <= close）
- **使用箇所**: CandleAccumulator, TimeFrameBook, MarketSnapshot

FormingCandleは例外的に可変です。`update(tick: Tick): CandleEvent`でHigh/Low/Closeを更新し、`confirm(closeTime: CandleCloseTime): CandleEvent`で確定イベントを返し、`toConfirmed(closeTime: CandleCloseTime): ConfirmedCandle`でConfirmedCandleに変換します。値オブジェクトではなく、ドメインオブジェクトとして扱います。

---

#### ConfirmedCandle（確定足）

- **意味**: 確定したローソク足です。一度確定したら二度と変わりません
- **型の内部表現**: `Price`(open, high, low, close) + `CandleOpenTime` + `CandleCloseTime` + `TimeFrame`
- **制約**: FormingCandleと同じOHLC整合性制約。加えてcloseTime > openTime
- **使用箇所**: TimeFrameBook, IndicatorLedger, MarketSnapshot

---

### 判定結果関連

---

#### EntryCommand

- **意味**: 「この通貨ペアを、この方向で、この数量でエントリーせよ」という命令書です。EntryRule が生成し、PositionManager が `requiredMargin` を埋めて EntryQueue に流します
- **型の内部表現**: `CurrencyPair` + `BuySell` + `Lot` + `StrategyName` + `EntryReason`(reason) + `ConvictionScore` + `EntrySnapshot`(entrySnapshot) + `Money`(requiredMargin)
- **制約**:
  - 全フィールド必須
  - `requiredMargin = rate × lot × marginRate` を生成時点で確定させ、EntryQueue 側でレートを再取得しない（責務分離）
  - reason は人間が読むためのもの（ログ用）
  - convictionScore は記録・分析用
  - entrySnapshot はエントリー時点のレート・指標値などの監査ログ
- **使用箇所**: EntryRule（生成）, PositionManager（`requiredMargin` 付与）, EntryQueue（`reservedMargin()` で `requiredMargin` を合算）, EntryExecution（実行 → `position_entry_snapshots` に保存）

**Note**: `requiredMargin` を `EntryCommand` 自体に持たせる理由は、`EntryQueue.reservedMargin()` を「保持済みの値を合算するだけの純関数」にするためです。レート取得責務は `PositionManager` / `PositionSizingService` に閉じ、EntryQueue はレートも `MarginRate` も知らずに済みます（policies.md 3.3.1 の C8 / P10 確定）。

---

#### ExitCommand

- **意味**: 「このポジションを決済せよ」という命令書です。ExitRuleが生成します
- **型の内部表現**: `ExitType`(TAKE_PROFIT/STOP_LOSS) + `PositionId` + `ExitReason`(reason)
- **制約**: 全フィールド必須。ExitTypeは利確か損切りかの区分
- **使用箇所**: ExitRule(生成), TradingSession(受け渡し), ExitExecution(実行)

---

#### EntryReason（エントリー理由）

- **意味**: エントリー判定の理由を表す値オブジェクトです。Ruleが「なぜエントリーすべきと判断したか」を人間が読める形で記録します
- **型の内部表現**: `String`
- **制約**: 空文字不可。Ruleが生成する
- **使用箇所**: EntryCommand(含む), ログ出力

---

#### ExitReason（決済理由）

- **意味**: 決済判定の理由を表す値オブジェクトです。Ruleが「なぜ決済すべきと判断したか」を人間が読める形で記録します
- **型の内部表現**: `String`
- **制約**: 空文字不可。Ruleが生成する
- **使用箇所**: ExitCommand(含む), ログ出力

---

#### DoNothing

- **意味**: 「何もしない」を型で表現したものです。nullの代わりに使います
- **型の内部表現**: フィールドなし（シングルトン）
- **制約**: なし
- **使用箇所**: EntryRule, ExitRule（判定結果が「何もしない」の場合）

```java
public class DoNothing {
    private static final DoNothing INSTANCE = new DoNothing();

    private DoNothing() {}

    public static DoNothing instance() { return INSTANCE; }

    @Override
    public String toString() { return "DoNothing"; }
}
```

Ruleの戻り値を`Optional<EntryCommand>`にしてはいけません。「何もしない」は「値がない」ではなく「何もしないという判断をした」という積極的な意思決定です。`DoNothing`はその意思決定を型で表現しています。

---

#### EntryResult

- **意味**: エントリー注文が約定した結果です。ブローカーから返ってきます
- **型の内部表現**: `PositionId` + `Price`(entryPrice) + `Timestamp`(executedAt)
- **制約**: 全フィールド必須
- **使用箇所**: EntryExecution, Position.open()

---

#### ExitResult

- **意味**: 決済注文が約定した結果です。ブローカーから返ってきます
- **型の内部表現**: `Price`(exitPrice) + `Timestamp`(executedAt) + `Pips`(profitLoss)
- **制約**: 全フィールド必須
- **使用箇所**: ExitExecution, Position.close()

---

### コレクション

---

#### OpenPositions

- **意味**: 未決済ポジションのコレクションです。ファーストクラスコレクションとして、コレクション操作にドメインの意味を持たせます
- **型の内部表現**: `List<Position>`（防御的コピーで外部に渡す）
- **制約**: 同一通貨ペアの同方向ポジションの重複チェックなど、ビジネスルールを内包します
- **使用箇所**: ExitRule（決済判定時に全ポジションを走査）, TradingSession

```java
public class OpenPositions {
    private final List<Position> positions;

    public OpenPositions(List<Position> positions) {
        this.positions = List.copyOf(positions);
    }

    public boolean isEmpty() { return positions.isEmpty(); }

    public boolean hasPositionFor(CurrencyPair pair) {
        return positions.stream()
            .anyMatch(p -> p.currencyPair().equals(pair));
    }

    public List<Position> toList() {
        return positions;
    }
}
```

**Note (Issue #51 で追加予定の集約 API / N-M1)**: `policies.md` 1.6 / 2.5 と `composition-exit-and-ports.drawio` で前提にしている以下のメソッドは、`OpenPositions` の正式な集約 API として別 issue で追加する予定:

- `openOf(pair: CurrencyPair, strategy: StrategyName): Position | null` — `(pair, strategy_name)` で OPEN ポジションを 1 件返す（未保有なら null）。`PositionRepository.findOpenByPairAndStrategy` の上位に立つ集約レベル API
- `totalRequiredMargin(): Money` — 保有ポジションの必要証拠金合計。`PositionManager` のフォールバック経路（`balance - usedMargin - pendingMargin`）で利用

実装は Step 5 の作業ブランチで `OpenPositions` を拡張する。本書はこの段階で「既存 API + 追加予定 API」の両方が前提になっている点を注記する。

**Note (Step 8 PR A / PR B で追加済みの集約 API / N-M2)**:

- `sortedByOpenedAtAsc(): OpenPositions` — 自己同型。`openedAt` 昇順、同時刻は `PositionId.compareTo` 順（評価順の決定論化 / H12）
- `forPair(pair: CurrencyPair): OpenPositions` — 自己同型。pair 射影（既存 `xxxFor(pair)` 慣習）
- `heldStrategyNames(): ReadonlySet<StrategyNameValue>` — 全 pair の保有戦略集合（起動時 fail-fast 検証で使用）

---

### PositionManager 関連（Issue #51）

Issue #51「ポジションマネージャー + 動的ロット」で追加する値オブジェクトです。既存の値オブジェクト（Lot, Price, CurrencyPair 等）と合わせて、`number` や `Map` をドメイン層から追い出すための土台になります。
コード例は TypeScript（`class` + `private constructor` + `static factory method`）で示します。`BigDecimal` 相当の精度が必要な箇所は `big.js` を使います。

---

#### LotAllocation（ロット配分結果）

- **意味**: `AllocationPolicy.decide()` の計算結果。「戦略 A に 0.4、戦略 B に 0.3、……」といった**戦略ごとの配分比率の束**です。合計=1.0 の不変条件を内部で守り、外部には `Map` を一切露出させません
- **型の内部表現**: `Map<StrategyNameValue, Ratio>`（private 保持。`StrategyNameValue` は `'SMA_CROSS' | 'RSI_REVERSAL' | 'SMA_DISTANCE' | 'WICK_REVERSAL'` の string literal union。`StrategyName` 自体をキーにすると現状の class 実装で `of()` が毎回 new して等価性が壊れるため、N-C1 で string キーに統一。issue #130 の singleton 化完了後にキーを `StrategyName` 自体に戻す）
- **制約**:
  - 比率の合計は 1.0、かつ `|sum - 1.0| <= Ratio.EPSILON`（1e-9）以内
  - ただし全戦略が抑制されてゼロの場合のみ合計 0.0 を許容する（「今サイクルは発注しない」の表明）
  - 各比率は 0.0〜1.0（`Ratio` 側で保証）
  - 生成後は変更不可
- **使用箇所**: `AllocationPolicy.decide()`（生成）, `PositionManager`（`apply(baseLot)` で各戦略の発注 Lot を算出）
- **振る舞い**:
  - `ratioOf(strategy: StrategyName): Ratio` — 指定戦略の配分比率を返す。含まれない戦略は `Ratio.zero()`
  - `isSuppressed(strategy: StrategyName): boolean` — 当該戦略が抑制されているか（= 比率ゼロか）
  - `isFullySuppressed(): boolean` — 全戦略が抑制（= 全比率ゼロ）か。PositionManager が「今サイクルは何も発注しない」を早期判定する用途
  - `apply(baseLot: Lot): StrategyLots` — ベースロットに各比率を掛けて戦略別 Lot の VO を返す。**生 `Map` を返さない**（設計憲法 6.10）
  - `strategies(): StrategyName[]` — 配分対象の戦略一覧（`Ratio.zero()` の戦略は除外）
- **ファクトリ**:
  - `LotAllocation.of(entries: Map<StrategyName, Ratio>)` — 通常の生成（合計=1.0 を厳密検証）
  - `LotAllocation.suppressed(strategies: StrategyName[])` — 全戦略を `Ratio.zero()` で抑制した状態を返す（C4）。「今サイクルは発注しない」を意図表明する型
- **等価性**: 保持する戦略集合が一致し、かつ各戦略の `Ratio` が `equals` で一致する場合に等価

```typescript
import { StrategyName, StrategyNameValue } from '../rule/StrategyName.js';
import { Ratio } from '../Ratio.js';
import { BigSum } from '../BigSum.js';
import { Lot } from '../position/Lot.js';
import { StrategyLots } from '../position/StrategyLots.js';

export class LotAllocation {
  private constructor(private readonly ratios: Map<StrategyNameValue, Ratio>) {}

  static of(entries: Map<StrategyName, Ratio>): LotAllocation {
    const inner = new Map<StrategyNameValue, Ratio>();
    let sum: BigSum = BigSum.zero();
    let allZero = true;
    for (const [strategy, ratio] of entries) {
      // StrategyName は branded string ゆえ StrategyNameValue としてそのまま key に使える（#130）
      inner.set(strategy, ratio);
      sum = sum.addRatio(ratio); // 合算経路は BigSum で行い、Ratio の不変条件を破らない
      if (!ratio.isZero()) allZero = false;
    }
    if (!allZero && !sum.isApproximatelyOne(Ratio.EPSILON)) {
      throw new Error(`LotAllocation の比率合計は 1.0 ± EPSILON: sum=${sum.toString()}`);
    }
    return new LotAllocation(inner);
  }

  static suppressed(strategies: StrategyName[]): LotAllocation {
    const inner = new Map<StrategyNameValue, Ratio>();
    for (const s of strategies) inner.set(s, Ratio.zero());
    return new LotAllocation(inner);
  }

  ratioOf(strategy: StrategyName): Ratio {
    return this.ratios.get(strategy) ?? Ratio.zero();
  }

  isSuppressed(strategy: StrategyName): boolean {
    return this.ratioOf(strategy).isZero();
  }

  isFullySuppressed(): boolean {
    return Array.from(this.ratios.values()).every((r) => r.isZero());
  }

  apply(baseLot: Lot): StrategyLots {
    return StrategyLots.fromAllocation(this.ratios, baseLot);
  }

  strategies(): StrategyName[] {
    // 生 Map を露出させず StrategyName へ戻して返す（API 境界）
    return Array.from(this.ratios.entries())
      .filter(([, r]) => !r.isZero())
      .map(([v]) => StrategyName(v));
  }
}
```

`Map` を外に出さない理由は「合計=1.0 の不変条件を**クライアントコードから壊せない**ようにする」ためです。`entries.set(strategy, ...)` を外側から呼べてしまうと、値オブジェクトの保証が崩れます。`apply()` の戻り値も `StrategyLots` で同じ規律を貫きます（設計憲法 6.10）。

**Note**: 将来 `ConvictionScore` を配分に反映する `ConvictionWeightedAllocationPolicy` を追加する場合も、戻り値は同じ `LotAllocation` です。`LotAllocation` は「結果」であり、「結果の作り方」は Policy 側の責務です（brief.md 5.2 節）。

---

#### Ratio（比率）

- **意味**: 0.0〜1.0 の比率を表す汎用値オブジェクト。`LotAllocation` の要素、`Balance` の按分、将来の重み付けなどで使います
- **型の内部表現**: `Big`（big.js）
- **制約**: `0.0 <= value <= 1.0`
- **丸め規則**: 小数第 10 位で**切り捨て**（`Big.roundDown`）。表示と内部保持の両方でこの桁数に正規化する。N=3 や N=7 の等ウェイト残余寄せ（brief.md 5.2 節 N-H5）で `1/N` を 10 桁切り捨てした値を使うため、4 桁では精度不足
- **EPSILON**: `Ratio.EPSILON = new Big('0.000000001')`（1e-9）。`LotAllocation.of` の合計検証で `|sum - 1.0| <= EPSILON` を許容するための定数。VO 内部に閉じ込めて、呼び出し側に「魔法の数字 1e-9」を書かせない
- **使用箇所**: `LotAllocation`, `Balance.multipliedBy`, `Money.times`, `EqualWeightAllocationPolicy`（残余寄せ）
- **振る舞い**:
  - `add(other: Ratio): Ratio` — 和。結果が 1.0 を超えたらエラー（比率の合成は通常 1.0 までに制限）
  - `addUnchecked(other: Ratio): BigSum` — 和。1.0 超のチェックを行わず、結果は 1.0 を超えうる中間合算用の BigSum 型を返す。残余寄せの中間合算で使う
  - `times(other: Ratio): Ratio` — 積（0〜1 の範囲に必ず収まるので制約違反なし）
  - `applyTo(lot: Lot): Lot` — Lot にかけて新しい Lot を返す（100 の倍数に切り捨てて `Lot.of` に通す）
  - `isZero(): boolean`
  - `toBig(): Big` — `LotAllocation.of` の `|sum - 1.0|` 判定など、Big 演算が必要な内部実装で使う
  - `equals(other: Ratio): boolean`
- **等価性**: `Big.eq` で数値比較
- **ファクトリ**: `Ratio.of(value)`, `Ratio.zero()`, `Ratio.one()`

```typescript
import Big from 'big.js';
import { BigSum } from './BigSum.js';
import { Lot } from './position/Lot.js';

export class Ratio {
  private static readonly SCALE = 10;
  static readonly EPSILON: Big = new Big('0.000000001'); // 1e-9。LotAllocation.of の合計検証で使用

  private constructor(private readonly value: Big) {}

  static of(value: string | number): Ratio {
    const raw = new Big(value);
    if (raw.lt(0) || raw.gt(1)) {
      throw new Error(`Ratio は 0.0〜1.0: ${value}`);
    }
    const v = raw.round(Ratio.SCALE, Big.roundDown);
    return new Ratio(v);
  }

  static zero(): Ratio { return new Ratio(new Big(0)); }
  static one(): Ratio { return new Ratio(new Big(1)); }

  add(other: Ratio): Ratio {
    const sum = this.value.plus(other.value);
    if (sum.gt(1)) {
      throw new Error(`Ratio の合計は 1.0 を超えられません: ${sum.toFixed(Ratio.SCALE)}`);
    }
    return new Ratio(sum);
  }

  /**
   * 1.0 超を許容する加算。残余寄せの中間合算で使用。
   * Ratio の 0.0〜1.0 不変条件を破らないために、戻り値は Ratio ではなく BigSum 型。
   */
  addUnchecked(other: Ratio): BigSum {
    return BigSum.zero().addRatio(this).addRatio(other);
  }

  times(other: Ratio): Ratio {
    return new Ratio(this.value.times(other.value).round(Ratio.SCALE, Big.roundDown));
  }

  applyTo(lot: Lot): Lot {
    const scaled = new Big(lot.toNumber()).times(this.value);
    const rounded = scaled.div(100).round(0, Big.roundDown).times(100).toNumber();
    return Lot.of(rounded);
  }

  isZero(): boolean { return this.value.eq(0); }

  toBig(): Big { return this.value; }

  equals(other: Ratio): boolean { return this.value.eq(other.value); }

  toString(): string { return this.value.toFixed(Ratio.SCALE); }
}
```

**Note**: 「比率」は金融システム全体で多用されるため、`domain/` 直下に置きます。特定のユースケース（例: `LotAllocation` 専用）に閉じ込めない。

**Note (残余寄せルール / N-H5)**: 等ウェイト N=3 の理論比率 `1/3` は 10 桁切り捨てで `0.3333333333` となり、3 倍しても 1.0 になりません。`EqualWeightAllocationPolicy` は先頭 `n-1` 戦略に `r = 1/n`、末尾戦略に `1 - (n-1) × r` を割り当てて合計=1.0 を厳密に保ちます。誤差は `Ratio.EPSILON` 内に収まる前提で `LotAllocation.of` が検証します。

---

#### BigSum（制約のない比率合計）

- **意味**: `Ratio.addUnchecked` の戻り値型。残余寄せ等の中間合算で `Ratio` の 0.0〜1.0 不変条件を破らないために導入する**中間型**。`LotAllocation.of` の合計検証で `|sum - 1.0| <= Ratio.EPSILON` を判定する経路で使う
- **型の内部表現**: `Big`（big.js）
- **制約**: なし（負・正・1.0 超いずれも許容）
- **使用箇所**: `Ratio.addUnchecked`（戻り値）, `LotAllocation.of`（合計蓄積）
- **振る舞い**:
  - `addRatio(ratio: Ratio): BigSum` — Ratio を加算した新しい BigSum を返す
  - `add(other: BigSum): BigSum` — BigSum 同士の加算
  - `isApproximatelyOne(epsilon: Big): boolean` — `|this - 1.0| <= epsilon` を判定。`LotAllocation.of` の合計検証で使う
  - `toBig(): Big` — `LotAllocation.of` の `|sum - 1.0|` 判定で使用（@internal）
  - `equals(other: BigSum): boolean`
  - `toString(): string`
- **ファクトリ**: `BigSum.zero()`、`BigSum.fromRatio(ratio: Ratio): BigSum`

サンプル実装は省略（Ratio とほぼ同型のシンプルな Big ラッパ）。

**Note (型不変条件防御)**: `Ratio.addUnchecked` の戻り値を `Ratio` にすると 1.0 超の Ratio が型レベルで作れてしまい、Ratio の不変条件（0.0〜1.0）が破られます。BigSum を中間型として独立させることで、Ratio 型の値はすべて 0.0〜1.0 の不変条件を満たすことが型システムで保証されます。

---

#### Balance（残高）

- **意味**: 口座の残高を表す値オブジェクト。`BalancePort.current()` の戻り値として `PositionSizingService` が受け取ります
- **型の内部表現**: `Money`（金額+通貨）
- **制約**:
  - 非負（`amount >= 0`）
  - 通貨情報を内包する（JPY のみを想定するが、型として将来拡張可能）
  - 生成後は変更不可
- **使用箇所**: `BalancePort`, `PositionSizingService`, `AllocationContext`, `LotDecisionInput`
- **振る舞い**:
  - `multipliedBy(ratio: Ratio): Money` — 残高の一部を按分した金額を返す（例: 残高 × 0.04 = 必要証拠金相当）
  - `minus(other: Money): Balance` — 金額を差し引いた新しい残高。負になったらエラー
  - `isZero(): boolean`
  - `toMoney(): Money`
  - `toString(): string` — 内部 Money の toString に委譲（"<amount> <currency>" 形式）

```typescript
import { Money } from './Money.js';
import { Ratio } from './Ratio.js';

export class Balance {
  private constructor(private readonly money: Money) {}

  static of(money: Money): Balance {
    if (money.isNegative()) {
      throw new Error(`Balance は非負: ${money.toString()}`);
    }
    return new Balance(money);
  }

  multipliedBy(ratio: Ratio): Money {
    return this.money.times(ratio);
  }

  minus(other: Money): Balance {
    const next = this.money.minus(other);
    if (next.isNegative()) {
      throw new Error(
        `Balance を差し引くと負になります: ${this.money.toString()} - ${other.toString()}`,
      );
    }
    return new Balance(next);
  }

  isZero(): boolean { return this.money.isZero(); }

  toMoney(): Money { return this.money; }

  equals(other: Balance): boolean { return this.money.equals(other.money); }

  toString(): string { return this.money.toString(); }
}
```

**Note**: 将来「利用可能残高（`AvailableBalance`）= 総残高 − 他ポジションの必要証拠金」と「純残高（`Balance`）」を区別する必要が出てくる見込みです（brief.md 5.1 節「二重建てによる証拠金オーバーを防ぐ」）。その時は `AvailableBalance` を別の値オブジェクトとして切り出す想定。`Balance` 自体に「フォールバックかどうか」等のメタを持たせない（`main.ts` 側で注入する）。

---

#### Money（金額）

- **意味**: 金額と通貨のセット。ドメイン層で金額を扱う際のベースとなる値オブジェクト。`Balance` の中身でもあります
- **型の内部表現**: `Big`（big.js） + `Currency`（通貨種別 enum）
- **制約**:
  - 通貨が異なる `Money` どうしの演算はエラー（JPY と USD は足せない）
  - 値そのものは正負を許容（差し引き結果が負になりうる中間値で使うため）。非負制約が必要な場所は `Balance` 側で守る
- **使用箇所**: `Balance`, `PositionSizingService`（必要証拠金の計算）
- **振る舞い**:
  - `plus(other: Money): Money`
  - `minus(other: Money): Money`
  - `times(ratio: Ratio): Money`
  - `isNegative(): boolean`
  - `isZero(): boolean`
  - `equals(other: Money): boolean`
- **ファクトリ**: `Money.jpy(value: number | string): Money`、`Money.of(value, currency): Money`

```typescript
import Big from 'big.js';
import { Ratio } from './Ratio.js';

export type Currency = 'JPY' | 'USD' | 'EUR' | 'GBP' | 'AUD';

export class Money {
  private constructor(
    private readonly value: Big,
    private readonly currency: Currency,
  ) {}

  static of(value: number | string, currency: Currency): Money {
    return new Money(new Big(value), currency);
  }

  static jpy(value: number | string): Money {
    return Money.of(value, 'JPY');
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`通貨不一致: ${this.currency} vs ${other.currency}`);
    }
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  times(ratio: Ratio): Money {
    return new Money(this.value.times(new Big(ratio.toString())), this.currency);
  }

  isNegative(): boolean { return this.value.lt(0); }
  isZero(): boolean { return this.value.eq(0); }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.eq(other.value);
  }

  toBig(): Big { return this.value; }
  currencyCode(): Currency { return this.currency; }

  toString(): string { return `${this.value.toFixed()} ${this.currency}`; }
}
```

**Note**: `Money` の中に `Currency` を持たせることで、通貨不一致の演算をコンパイル/実行時に防げます。`Price` は「相場価格」、`Money` は「金額」で役割が異なります（Price × Lot = Money の関係）。

---

#### Rate（現在レート）

- **意味**: 通貨ペアの現在レートを表す値オブジェクト。`PositionSizingService` が必要証拠金を算出する際の入力です。**null を返さない**（取得失敗時は `RatePort` が例外を投げ、発注を中止する）
- **型の内部表現**: `Big`（big.js） + `CurrencyPair` + epoch ms（`number`、防御的コピーで `Date` から保持）
- **制約**:
  - `value > 0`
  - 通貨ペアと整合する pip 単位を持つ（クロス円は小数 3 桁、EUR_USD 等は 5 桁）
  - 生成後は変更不可
- **使用箇所**: `RatePort`, `PositionSizingService`, `LotDecisionInput`
- **振る舞い**:
  - `toBig(): Big`
  - `pipDifference(other: Rate): Pips` — 2 つのレート間の値幅を Pips で返す
  - `isFreshEnough(now: Instant, maxAge: Duration): boolean` — キャプチャ時刻から `maxAge` 以内か
  - `pair(): CurrencyPair`
  - `capturedAt(): Instant`
- **ファクトリ**: `Rate.of(value, pair, capturedAt): Rate`

```typescript
import Big from 'big.js';
import { currencyPairEquals, type CurrencyPair } from './CurrencyPair.js';
import { Pips } from './Pips.js';

export class Rate {
  private constructor(
    private readonly value: Big,
    private readonly pairValue: CurrencyPair,
    private readonly capturedAtMillis: number,
  ) {}

  static of(value: number | string, pair: CurrencyPair, capturedAt: Date): Rate {
    const v = new Big(value);
    if (v.lte(0)) {
      throw new Error(`Rate は正の数: ${value}`);
    }
    return new Rate(v, pair, capturedAt.getTime());
  }

  /** @internal */
  toBig(): Big { return this.value; }
  pair(): CurrencyPair { return this.pairValue; }
  /** 防御的コピーを返す（外部から内部 Date を変更不可にするため） */
  capturedAt(): Date { return new Date(this.capturedAtMillis); }

  pipDifference(other: Rate): Pips {
    if (!currencyPairEquals(this.pairValue, other.pairValue)) {
      throw new Error(`Rate の通貨ペアが一致しません: ${this.pairValue} vs ${other.pairValue}`);
    }
    const diff = this.value.minus(other.value);
    return Pips.of(diff.toFixed());  // Pips.of は string のみ受け取る
  }

  isFreshEnough(now: Date, maxAgeMillis: number): boolean {
    return now.getTime() - this.capturedAtMillis <= maxAgeMillis;
  }

  equals(other: Rate): boolean {
    return currencyPairEquals(this.pairValue, other.pairValue)
      && this.value.eq(other.value)
      && this.capturedAtMillis === other.capturedAtMillis;
  }
}
```

**Note**: 既存の `MarginBasedLotPolicy` は `getCurrentRate: () => number | null` を受け取っていましたが、これを `Rate` に置き換えることで「古いレートで発注する」「null チェックを忘れる」といった事故を型で防ぎます（brief.md 5.1 節）。

**Note (Date ミュータビリティ防御)**: `Date` は `setTime` 等で外部から変更可能なミュータブル型のため、内部表現を `number`（epoch ms）として保持し、`capturedAt()` では `new Date(ms)` で都度防御的コピーを返します。`Rate.of` のコンストラクタも `getTime()` で値を取り出して保持するため、呼び出し側が後から渡した `Date` を `setTime` しても内部状態は変わりません。

---

#### MaintenanceRatio（目標維持率）

- **意味**: エントリー時に狙う**証拠金維持率の目標値**（例: 1.4 = 140%）。`MaintenanceRatioBasedLotPolicy` がこの値を基準に Lot を逆算します
- **型の内部表現**: `Big`（big.js）
- **制約**: `value > 1.0`（1.0 以下は強制決済ラインを下回るため、目標値として許容しない）
- **使用箇所**: `MaintenanceRatioBasedLotPolicy`, `LotDecisionInput`
- **振る舞い**:
  - `toNumber(): number`
  - `toBig(): Big`
  - `equals(other: MaintenanceRatio): boolean`
- **ファクトリ**: `MaintenanceRatio.of(value: number): MaintenanceRatio`

```typescript
import Big from 'big.js';

export class MaintenanceRatio {
  private constructor(private readonly value: Big) {}

  static of(value: number | string): MaintenanceRatio {
    const v = new Big(value);
    if (v.lte(1)) {
      throw new Error(`MaintenanceRatio は 1.0 超: ${value}`);
    }
    return new MaintenanceRatio(v);
  }

  toNumber(): number { return this.value.toNumber(); }
  /** @internal */
  toBig(): Big { return this.value; }

  equals(other: MaintenanceRatio): boolean { return this.value.eq(other.value); }

  toString(): string { return this.value.toFixed(); }
}
```

**Note**: 「維持率」は複数の意味を持ちうる用語（現在維持率・目標維持率・強制決済ライン）ですが、本 VO は**目標値**専用です。現在値はリアルタイム計算するため値オブジェクト化しません（将来必要になれば `CurrentMaintenanceRatio` を別途切り出す）。

---

#### MarginRate（証拠金率）

- **意味**: 証拠金率（= 1 / レバレッジ）。GMO FX 国内ユーザーは 0.04（レバレッジ 25 倍）固定
- **型の内部表現**: `Big`（big.js）
- **制約**: `0 < value < 1`
- **使用箇所**: `MaintenanceRatioBasedLotPolicy`, `LotDecisionInput`
- **振る舞い**:
  - `toNumber(): number`
  - `toBig(): Big`
  - `leverageEquivalent(): number` — `1 / value` を返す（表示・ログ用）
  - `toString(): string`
  - `equals(other: MarginRate): boolean`
- **ファクトリ**: `MarginRate.of(value: number | string): MarginRate` のみ

```typescript
import Big from 'big.js';

export class MarginRate {
  private constructor(private readonly value: Big) {}

  static of(value: number | string): MarginRate {
    const v = new Big(value);
    if (v.lte(0) || v.gte(1)) {
      throw new Error(`MarginRate は 0 超 1 未満: ${value}`);
    }
    return new MarginRate(v);
  }

  toNumber(): number { return this.value.toNumber(); }
  /** @internal */
  toBig(): Big { return this.value; }

  leverageEquivalent(): number {
    return new Big(1).div(this.value).toNumber();
  }

  toString(): string { return this.value.toFixed(); }

  equals(other: MarginRate): boolean { return this.value.eq(other.value); }
}
```

**Note (業者依存値の分離 / brief.md 5.1 R10 / H9)**: 以前の設計では `MarginRate.gmoFxRetail()` のような業者ショートカットファクトリを VO に持たせていましたが、**ドメインに業者名を漏らすとブローカー追加時にドメインモデルが分岐し始め純粋性が壊れる**ため削除しました。業者依存値（0.04）は `infrastructure/gmo/GmoConstants.MARGIN_RATE = MarginRate.of('0.04')` で定義し、`main.ts` で `PositionSizingService` のコンストラクタに `marginRate` として DI 注入します。値そのもの（0.04）は infrastructure 側コンフィグ、型（`MarginRate`）はドメイン側、という分離を維持します。

---

#### LotDecisionInput（ロット決定の入力）

- **意味**: `LotPolicy.decide()` の呼び出しパラメータを束ねる**パラメータオブジェクト**。引数列の爆発を防ぎ、`LotPolicy` のシグネチャを安定させる目的で設ける
- **型の内部表現**: `CurrencyPair` + `Balance` + `Rate` + `MaintenanceRatio` + `MarginRate`
- **制約**:
  - 全フィールド必須
  - 生成後は変更不可（ゲッターのみ）
  - `Balance` の通貨と `Rate` の quote 通貨（`quote(rate.pair())`）が整合していること（JPY quote 前提なので、quote が JPY の場合は `Balance` も JPY）
- **使用箇所**: `PositionSizingService`（生成）, `LotPolicy.decide`（受け取る）
- **振る舞い**: ゲッターのみ（`pair()`, `balance()`, `rate()`, `target()`, `marginRate()`）
- **等価性**: 全フィールドが `equals` で一致する場合に等価（通常は比較する場面が少ないのでログ用途）

```typescript
import { quote, currencyPairEquals, type CurrencyPair } from '../market/CurrencyPair.js';
import { Balance } from '../Balance.js';
import { Rate } from '../market/Rate.js';
import { MaintenanceRatio } from './MaintenanceRatio.js';
import { MarginRate } from './MarginRate.js';

export class LotDecisionInput {
  private constructor(
    private readonly pairValue: CurrencyPair,
    private readonly balanceValue: Balance,
    private readonly rateValue: Rate,
    private readonly targetValue: MaintenanceRatio,
    private readonly marginRateValue: MarginRate,
  ) {}

  static of(
    pair: CurrencyPair,
    balance: Balance,
    rate: Rate,
    target: MaintenanceRatio,
    marginRate: MarginRate,
  ): LotDecisionInput {
    if (!currencyPairEquals(rate.pair(), pair)) {
      throw new Error(
        `Rate の通貨ペアが一致しません: input=${pair} rate=${rate.pair()}`,
      );
    }
    const quoteCurrency = quote(pair);
    const balanceCurrency = balance.toMoney().currencyCode();
    if (balanceCurrency !== quoteCurrency) {
      throw new Error(
        `Balance の通貨と Rate の quote 通貨が不一致: balance=${balanceCurrency} quote=${quoteCurrency}`,
      );
    }
    return new LotDecisionInput(pair, balance, rate, target, marginRate);
  }

  pair(): CurrencyPair { return this.pairValue; }
  balance(): Balance { return this.balanceValue; }
  rate(): Rate { return this.rateValue; }
  target(): MaintenanceRatio { return this.targetValue; }
  marginRate(): MarginRate { return this.marginRateValue; }
}
```

**Note**: 将来 `LotPolicy` が別のコンテキスト情報（例: `ConvictionScore`, `Volatility`）を必要とした場合、`LotDecisionInput` のフィールドを追加するだけで `LotPolicy` のシグネチャは変わりません。引数追加で全ての実装クラスに波及するのを防ぐ目的のパラメータオブジェクトです（brief.md 5.1 節 案 D 却下の背景）。

---

#### TotalUnits（戦略合計の通貨数量）

- **意味**: 複数戦略の Lot を合計した通貨数量。**`Lot` とは別 VO** にする。`Lot` は単一ポジションの 100〜500,000 制約を持つが、合計値はそれを超えうるため
- **型の内部表現**: `Big`（big.js）非負整数
- **制約**:
  - `value >= 0`
  - 単位制約なし（100 の倍数でなくてよい）
  - 上限なし
- **使用箇所**: `StrategyLots.totalLot()` の戻り値、`PositionManager` の合計ロット上限チェック
- **振る舞い**:
  - `plus(other: TotalUnits): TotalUnits`
  - `isExceedingSingleLotLimit(): boolean` — `Lot.SINGLE_LOT_MAX_UNITS`（500_000）を参照し、合計が単一ポジション上限を超えたかを判定。**外部から生定数を参照させない**（M11 / H-2）
  - `toNumber(): number` — JS の number に変換（合計値の概算表示用。精度が必要な場面では `toBig()`）
  - `toBig(): Big`
  - `equals(other: TotalUnits): boolean`
- **ファクトリ**: `TotalUnits.of(value: number | string): TotalUnits`、`TotalUnits.zero(): TotalUnits`、`TotalUnits.fromLot(lot: Lot): TotalUnits`

```typescript
import Big from 'big.js';
import { Lot } from './Lot.js';

export class TotalUnits {
  private constructor(private readonly value: Big) {}

  static of(value: number | string): TotalUnits {
    const v = new Big(value);
    if (v.lt(0)) {
      throw new Error(`TotalUnits は非負: ${value}`);
    }
    if (!v.mod(1).eq(0)) {
      throw new Error(`TotalUnits は整数: ${value}`);
    }
    return new TotalUnits(v);
  }

  static zero(): TotalUnits { return new TotalUnits(new Big(0)); }

  static fromLot(lot: Lot): TotalUnits {
    return new TotalUnits(new Big(lot.toNumber()));
  }

  plus(other: TotalUnits): TotalUnits {
    return new TotalUnits(this.value.plus(other.value));
  }

  isExceedingSingleLotLimit(): boolean {
    // 単一 Lot 上限は Lot.SINGLE_LOT_MAX_UNITS を参照（魔法の数字を持ち込まない）
    return this.value.gt(new Big(Lot.SINGLE_LOT_MAX_UNITS));
  }

  toBig(): Big { return this.value; }

  toNumber(): number { return this.value.toNumber(); }

  equals(other: TotalUnits): boolean { return this.value.eq(other.value); }

  toString(): string { return this.value.toFixed(); }
}
```

**Note (失敗パターン)**: 4 戦略 × 200,000 Lot = 800,000 通貨を `Lot.of(800_000)` に渡すと上限 500,000 で throw します。**合計値は必ず `TotalUnits` に入れる**ことで、ドメインの語彙レベルで「単一ポジションの上限」と「合計値の上限」を分離します。

---

#### StrategyLots（戦略別 Lot の束）

- **意味**: `LotAllocation.apply(baseLot)` の戻り値。「戦略 A → Lot(7,800)、戦略 B → Lot(3,400)、……」のように**戦略ごとに発注すべき Lot をまとめた値オブジェクト**。`LotAllocation` と同じく Map を API 境界に露出させない
- **型の内部表現**: `Map<StrategyNameValue, Lot>`（private 保持）
- **制約**:
  - 各 Lot は `Lot.of` を通った正常値（100〜500,000 の 100 倍数）
  - `Ratio.zero()` で抑制された戦略は含まれない（`apply` 時に除外）
  - 生成後は変更不可
- **使用箇所**: `LotAllocation.apply()`（生成）, `PositionManager`（戦略ごとに `EntryCommand` を組み立てる）
- **振る舞い**:
  - `lotOf(strategy: StrategyName): Lot | null` — 指定戦略の Lot。含まれなければ null
  - `strategies(): StrategyName[]` — 配分対象の戦略一覧
  - `totalLot(): TotalUnits` — 合計通貨数量。**戻り値は `TotalUnits`**（`Lot` ではない）
  - `isEmpty(): boolean` — 全戦略抑制で空か
- **等価性**: 戦略集合と各戦略の `Lot` が一致

```typescript
import { StrategyName, StrategyNameValue } from '../rule/StrategyName.js';
import { Lot } from './Lot.js';
import { Ratio } from '../Ratio.js';
import { TotalUnits } from './TotalUnits.js';

export class StrategyLots {
  private constructor(private readonly lots: ReadonlyMap<StrategyNameValue, Lot>) {}

  static fromAllocation(
    ratios: Map<StrategyNameValue, Ratio>,
    baseLot: Lot,
  ): StrategyLots {
    const inner = new Map<StrategyNameValue, Lot>();
    for (const [strategyValue, ratio] of ratios) {
      if (ratio.isZero()) continue;
      inner.set(strategyValue, ratio.applyTo(baseLot));
    }
    return new StrategyLots(inner);
  }

  lotOf(strategy: StrategyName): Lot | null {
    return this.lots.get(strategy) ?? null;
  }

  strategies(): StrategyName[] {
    return Array.from(this.lots.keys()).map((v) => StrategyName(v));
  }

  totalLot(): TotalUnits {
    // 合計は TotalUnits API 経由で行い、生 Big を持ち回らない
    let total = TotalUnits.zero();
    for (const lot of this.lots.values()) {
      total = total.plus(TotalUnits.fromLot(lot));
    }
    return total;
  }

  isEmpty(): boolean { return this.lots.size === 0; }
}
```

**Note (生 Map 非露出 / C3)**: `StrategyLots` は生 `Map` を返さず、必ず `lotOf` / `strategies` / `totalLot` の API 経由で問い合わせます。`Map<StrategyName, Lot>` を返してしまうと、呼び出し側の `for...of` 順序がキー挿入順依存となり、設計憲法 6.10「キー順序非依存」が破れます。

---

#### AllocationContext（配分判断の入力）

- **意味**: `AllocationPolicy.decide()` の呼び出しパラメータを束ねるパラメータオブジェクト
- **型の内部表現**: `CurrencyPair` + `DetectedSignals` + `OpenPositions` + `Balance`
- **制約**:
  - 全フィールド必須
  - `pair` は配分判断対象の通貨ペア。Policy は `currentPositions` のうち本 pair に紐づく保有戦略のみを抑制対象にする（multi-pair 時の異 pair 同戦略の誤抑制防止 / N-A1）
  - 渡される `Balance` は**利用可能残高**（含み損益込み、`BalancePort.availableAmount()` 由来）。純残高ではない（policies.md 1.6.2）
  - 生成後は変更不可
- **使用箇所**: `AllocationPolicy.decide()`（受け取る）, `PositionManager`（生成）
- **振る舞い**: ゲッターのみ（`pair()`, `detectedSignals()`, `currentPositions()`, `balance()`）+ `equals()` / `toString()`
- **ファクトリ**: `AllocationContext.of(pair, detectedSignals, currentPositions, balance)` — `balance.toMoney().currencyCode() === quote(pair)` を生成時に検証する

```typescript
import { CurrencyPair, currencyPairEquals, quote } from '../market/CurrencyPair.js';
import { DetectedSignals } from '../rule/DetectedSignals.js';
import { OpenPositions } from '../position/OpenPositions.js';
import { Balance } from '../Balance.js';

export class AllocationContext {
  private constructor(
    private readonly pairValue: CurrencyPair,
    private readonly detectedSignalsValue: DetectedSignals,
    private readonly currentPositionsValue: OpenPositions,
    private readonly balanceValue: Balance,
  ) {}

  static of(
    pair: CurrencyPair,
    detectedSignals: DetectedSignals,
    currentPositions: OpenPositions,
    balance: Balance,
  ): AllocationContext {
    const balanceCurrency = balance.toMoney().currencyCode();
    const pairQuote = quote(pair);
    if (balanceCurrency !== pairQuote) {
      throw new Error(
        `AllocationContext: balance 通貨 (${balanceCurrency}) と pair の quote 通貨 (${pairQuote}) が一致しません (pair=${String(pair)})`,
      );
    }
    return new AllocationContext(pair, detectedSignals, currentPositions, balance);
  }

  pair(): CurrencyPair { return this.pairValue; }
  detectedSignals(): DetectedSignals { return this.detectedSignalsValue; }
  currentPositions(): OpenPositions { return this.currentPositionsValue; }
  balance(): Balance { return this.balanceValue; }

  equals(other: AllocationContext): boolean {
    return (
      currencyPairEquals(this.pairValue, other.pairValue) &&
      this.detectedSignalsValue.equals(other.detectedSignalsValue) &&
      this.currentPositionsValue.equals(other.currentPositionsValue) &&
      this.balanceValue.equals(other.balanceValue)
    );
  }

  toString(): string {
    return `AllocationContext(pair=${String(this.pairValue)}, detected=${this.detectedSignalsValue.toString()}, positions=${this.currentPositionsValue.toString()}, balance=${this.balanceValue.toString()})`;
  }
}
```

**Note (N-A1: pair 単位の保有抑制)**: `EqualWeightAllocationPolicy` 等の Policy 実装は `currentPositions.holdsStrategyOnPair(pair, strategy)`（または集合一括の `heldStrategyNamesFor(pair)`）を呼び、本 pair に紐づく保有戦略のみを抑制対象にする。これにより multi-pair 同時運用時に「USD/JPY で SMA_CROSS シグナル発火 / EUR/JPY で SMA_CROSS 保有中」というケースで USD/JPY 側の SMA_CROSS が誤って抑制されることを防ぐ。`OpenPositions` 側に pair 限定の集約 API を持たせることで、Policy が `Position.strategyName` の内部表現に直接依存しない（カプセル化 / Tell, Don't Ask）。**`holdsStrategyOnPair` / `heldStrategyNamesFor` は Issue #51 Step7 PR(A) で `OpenPositions` に実装済み**（L657-663 の「別 issue 予定 API」群とは別。あちらは `openOf` / `totalRequiredMargin` / `sortedByOpenedAtAsc`）。

**Note**: 将来 `ConvictionScores` や `Volatility` を Policy が見たくなった場合、`AllocationContext` にフィールドを足すだけで `AllocationPolicy.decide()` のシグネチャは変わりません。`LotDecisionInput` と同じパラメータオブジェクトの設計趣旨です（brief.md 5.2 節）。

**Note (型ねじれ / M-N1, P4)**: 現状 `AllocationContext.balance` の型は `Balance`（純残高型）ですが、`PositionManager` から渡されるのは `BalancePort.availableAmount()` 由来の **利用可能残高（含み損益込み）** です。型と意味のねじれが残っています。設計憲法 6.3 に従い `AvailableBalance` 値オブジェクトを切り出すまでの間は、ドキュメント Note + ファクトリでの「これは利用可能残高として渡す」運用ガードのみとします。`AvailableBalance` 切り出しは別 issue（policies.md 4.4 P4）で追跡。

---

#### DetectedSignals（検知シグナル群）

- **意味**: `EntryRule` 群の評価結果として「シグナルが発火した戦略の集合」をまとめた値オブジェクト。`AllocationContext` の入力
- **型の内部表現**: `readonly StrategyName[]`（薄ラッパ）
- **制約**:
  - 重複なし（同じ戦略が 2 回入らない。判定は `StrategyName.equals` 経由）
  - 順序は安定（評価順を保つ。残余寄せの末尾戦略決定に影響）
  - **`equals()` は順序依存**（インデックスベース比較）。`['A', 'B']` ≠ `['B', 'A']`。順序決定論化は将来検討（brief.md 5.2 参照）
  - 生成後は変更不可
- **使用箇所**: `PositionManager`（Detect 段の戻り値）, `AllocationContext`（入力）
- **振る舞い**:
  - `contains(strategy: StrategyName): boolean`
  - `size(): number`
  - `isEmpty(): boolean`
  - `strategies(): readonly StrategyName[]` — 防御的コピーを返す（型レベルでも書き換え禁止）
  - `forEach(consumer: (s: StrategyName) => void): void` — 配列複製を強要しない走査 API
  - `equals(other: DetectedSignals): boolean` / `toString(): string`
- **ファクトリ**: `DetectedSignals.of(strategies: StrategyName[])`、`DetectedSignals.empty()`

```typescript
import type { StrategyName } from '../rule/StrategyName.js';

export class DetectedSignals {
  private constructor(private readonly strategiesValue: readonly StrategyName[]) {}

  static of(strategies: StrategyName[]): DetectedSignals {
    const seen: StrategyName[] = [];
    for (const s of strategies) {
      if (seen.some((existing) => existing.equals(s))) {
        throw new Error(`DetectedSignals に重複した戦略: ${s.value}`);
      }
      seen.push(s);
    }
    return new DetectedSignals([...strategies]);
  }

  static empty(): DetectedSignals { return new DetectedSignals([]); }

  contains(strategy: StrategyName): boolean {
    return this.strategiesValue.some((s) => s.equals(strategy));
  }

  size(): number { return this.strategiesValue.length; }

  isEmpty(): boolean { return this.strategiesValue.length === 0; }

  strategies(): readonly StrategyName[] { return [...this.strategiesValue]; }

  forEach(consumer: (strategy: StrategyName) => void): void {
    this.strategiesValue.forEach(consumer);
  }

  equals(other: DetectedSignals): boolean {
    if (this.strategiesValue.length !== other.strategiesValue.length) return false;
    return this.strategiesValue.every((s, i) => s.equals(other.strategiesValue[i]));
  }

  toString(): string {
    return `DetectedSignals(${this.strategiesValue.map((s) => s.value).join(', ')})`;
  }
}
```

**Note**: 当初は `StrategyName[]` を直接渡す案もありましたが、検出の「結果」というドメイン語彙を型に持たせ、重複検証を生成時に行うため VO 化しました（policies.md 4.4 P16）。

---

#### SizingResultLike / SizingResult / BacktestSizingResult（サイジング結果）

**型分離による安全保証（設計憲法 6.7 整合）**: 本番経路とバックテスト経路で別型を持ち、`requiredMarginFor(lot)`（本番でのみ意味を持つ操作）はコンパイル時に型分離される。「null マーカー + 実行時 throw」を排した型システムレベルの防御。

##### SizingResultLike（共通契約 / interface）

- **意味**: 本番 / バックテスト両経路の共通契約。`SmaCrossEntryRule.getSizing` 等が受ける型
- **メソッド**: `lot()`, `rate()`, `requiredMargin()`

```typescript
import type { Lot } from './Lot.js';
import type { Rate } from '../market/Rate.js';
import type { Money } from '../Money.js';

export interface SizingResultLike {
  lot(): Lot;
  rate(): Rate;
  requiredMargin(): Money;
}
```

##### SizingResult（本番用）

- **意味**: `PositionSizingService.executeWithFresh(pair)` の戻り値。**発注直前に決定した Lot・Rate・必要証拠金・MarginRate を 1 つに束ねる**ことで、`PositionManager` がレートを再取得せずに `EntryCommand` を組み立て、配分後 Lot の証拠金も `requiredMarginFor(lot)` で再計算できる（NH-2）
- **型の内部表現**: `Lot` + `Rate` + `Money`(requiredMargin) + `MarginRate`（**非 null**）
- **制約**:
  - `requiredMargin = rate × lot × marginRate` で算出
  - `marginRate` は必ず保持。バックテスト経路は別型 `BacktestSizingResult` を使う
  - `rate.pair()` と Lot を計算する際の通貨ペアが整合
  - 生成後は変更不可
- **使用箇所**: `PositionSizingService.executeWithFresh()`（生成）, `PositionManager`（`EntryCommand` 組み立て + `requiredMarginFor(lot)` で配分後 Lot の証拠金算出）
- **振る舞い**: ゲッター（`lot()`, `rate()`, `requiredMargin()`）+ `requiredMarginFor(lot: Lot): Money` + `equals` / `toString`
- **ファクトリ**: `SizingResult.of(lot, rate, marginRate)` — `requiredMargin` は内部で `Big` 計算

```typescript
import { Lot } from './Lot.js';
import { Rate } from '../market/Rate.js';
import { MarginRate } from './MarginRate.js';
import { Money } from '../Money.js';
import { requiredMarginAsJpy } from './RequiredMarginCalculator.js';
import type { SizingResultLike } from './SizingResultLike.js';

export class SizingResult implements SizingResultLike {
  private constructor(
    private readonly lotValue: Lot,
    private readonly rateValue: Rate,
    private readonly requiredMarginValue: Money,
    private readonly marginRateValue: MarginRate, // 非 null
  ) {}

  static of(lot: Lot, rate: Rate, marginRate: MarginRate): SizingResult {
    return new SizingResult(lot, rate, requiredMarginAsJpy(rate, lot, marginRate), marginRate);
  }

  lot(): Lot { return this.lotValue; }
  rate(): Rate { return this.rateValue; }
  requiredMargin(): Money { return this.requiredMarginValue; }

  /**
   * 別 Lot に対する必要証拠金を、本 SizingResult に閉じ込めた rate / marginRate で算出。
   * AllocationPolicy 配分後の Lot が baseLot と異なる場合に PositionManager が呼ぶ。
   * MarginRate を application 層に持たせない（NH-2: SizingResult に集約）。
   * バックテスト経路は本メソッドを呼ぶ場面がないため、専用型 BacktestSizingResult には設けない（型分離）。
   */
  requiredMarginFor(lot: Lot): Money {
    return requiredMarginAsJpy(this.rateValue, lot, this.marginRateValue);
  }
}
```

##### BacktestSizingResult（バックテスト用）

- **意味**: バックテスト経路で `SmaCrossEntryRule.getSizing` に渡す型。実際の証拠金チェックを行わないため `requiredMargin` は 0 円固定
- **型の内部表現**: `Lot` + `Rate`（ダミー）
- **使用箇所**: backtest の `RuleFactory.createRules` 等が生成
- **`requiredMarginFor(lot)` を持たない**: 設計憲法 6.7 整合のため、本番でのみ意味を持つ操作は型分離

```typescript
import { Money } from '../Money.js';
import { Rate } from '../market/Rate.js';
import { CurrencyPair } from '../market/CurrencyPair.js';
import { Lot } from './Lot.js';
import type { SizingResultLike } from './SizingResultLike.js';

export class BacktestSizingResult implements SizingResultLike {
  private constructor(
    private readonly lotValue: Lot,
    private readonly rateValue: Rate,
  ) {}

  static of(lot: Lot, pair: CurrencyPair): BacktestSizingResult {
    const dummyRate = Rate.of('1', pair, new Date(0));
    return new BacktestSizingResult(lot, dummyRate);
  }

  lot(): Lot { return this.lotValue; }
  rate(): Rate { return this.rateValue; }
  requiredMargin(): Money { return Money.jpy('0'); }
  // requiredMarginFor は意図的に持たない（本番でのみ意味を持つため型分離）
}
```

**Note (NH-2 集約 / 本 PR で確定)**: `PositionManager` が同 tick 内で `RatePort.currentFresh(pair)` を 2 回呼ぶ事故、および `MarginRate` を application 層で再注入する事故、の両方を防ぐ。`requiredMargin` の計算式（`rate × lot × marginRate`）は SizingResult 内部に閉じ込め、配分後 Lot 用の `requiredMarginFor(lot)` まで含めて NH-2 を完結させる。

**Note (型分離による設計憲法 6.7 整合)**: 本番経路の `SizingResult` とバックテスト経路の `BacktestSizingResult` は別型。共通契約 `SizingResultLike` を介して `SmaCrossEntryRule.getSizing` に渡すが、`requiredMarginFor` は本番型にのみ存在し、バックテスト型に対して呼ぶと **コンパイル時にエラー**になる。`null` マーカー + 実行時 throw を排した型システムレベルの防御。

---

### Step 8 PR A / PR B 追加分

#### PositionId.compareTo

```ts
compareTo(other: PositionId): number
```

- 内部 `value` の辞書順比較を返す（this < other で負、> で正、等価で 0）
- 評価順の二次キー用途（`OpenPositions.sortedByOpenedAtAsc` 内で `openedAt` 同時刻時の安定化）
- 全順序性 / 同値で 0 / 決定論性をテストで保証

#### ExitRuleRegistry

戦略名と `ExitRule` のペアを保持するファーストクラスコレクション。`ExitDispatcher` が戦略別 lookup する用途。

```ts
class ExitRuleRegistry {
  static of(entries: ReadonlyArray<readonly [StrategyName, ExitRule]>): ExitRuleRegistry
  findRule(strategy: StrategyName): ExitRule | undefined  // Dispatcher 通常経路: Optional
  ruleFor(strategy: StrategyName): ExitRule  // 起動時 fail-fast 用: 未登録時 MissingExitRuleError throw
  has(strategy: StrategyName): boolean
  registeredStrategies(): ReadonlySet<StrategyNameValue>
}
```

**Note（タプル配列入力 / D3）**: `Map<StrategyName, ExitRule>` 入力にしないのは、#130 未完で `StrategyName` の参照同値が壊れているため。タプル配列で受けて内部で `.value` 同値で重複検知する。#130 完了後は Map 入力へ書き換え可能。

**Note（2 API 提供）**:
- `findRule` は ExitDispatcher の通常フロー制御（Optional 返却で例外をフロー制御に流用しない）
- `ruleFor` は起動時 fail-fast 検証で「絶対あるべきところに無かった」ケースを明示的に表現（`RatePort.currentFresh` 流の throw 契約）

#### MissingExitRuleError

`ExitRuleRegistry.ruleFor` で未登録戦略を引いたときの domain Error（起動時 fail-fast 用途）。Dispatcher の通常経路は `findRule` の Optional 返却で扱うため、本 Error は実行時には基本発生しない。

```ts
class MissingExitRuleError extends Error {
  static notRegistered(strategyName: StrategyName): MissingExitRuleError
  readonly strategyName: StrategyName
}
```

**Note (factory 命名)**: `domain/error/` 配下の他 Error クラスと同じく「発生事象を述語で示す」factory 名 (`notRegistered`)。`DuplicatePositionError.detectedByDomain` と同じパターン。

#### ExitDispatchResult

`ExitDispatcher.dispatch` のバッチ集計結果。Position 単位で記録する。

```ts
interface ExitDispatchSkipEntry {
  readonly positionId: PositionId
  readonly strategy: StrategyName  // VO のまま保持（プリミティブ降格しない）
  readonly reason: 'rule_missing' | 'extremes_unavailable' | 'compensation_pending' | 'failure_cooldown'
}

interface ExitDispatchFailEntry {
  readonly positionId: PositionId
  readonly strategy: StrategyName
  readonly errorName: string  // Error.prototype.name 整合（運用ログ用途のため VO 化しない）
}

class ExitDispatchResult {
  static of(params: { closed, skipped, failed }): ExitDispatchResult
  static empty(): ExitDispatchResult
  hasFailure(): boolean
  readonly closed: readonly PositionId[]
  readonly skipped: readonly ExitDispatchSkipEntry[]
  readonly failed: readonly ExitDispatchFailEntry[]
}
```

**Note (`reason` の VO 化は別 Issue)**: ドメイン語彙としては `SkipReason.ruleMissing()` / `SkipReason.extremesUnavailable()` への VO 化が筋（`isTransient()` クエリも持たせる）。本 PR B では string literal union 維持。別 Issue G で対応予定。

**Note (#186 追加分)**: `compensation_pending`（broker 決済済み・DB 反映待ちのゴースト。補償キューのシールドで再決済を抑止）と `failure_cooldown`（決済失敗直後のクールダウン中。ExitFailureCircuitBreaker が tick 数で管理）を追加。いずれも一時状態のため `hasPermanentSkip()` には含めない。詳細は position-manager/exit-compensation.md。

**Note (`failed` と `skipped` の継承を切る)**: PR A 時点では `ExitDispatchFailEntry extends ExitDispatchSkipEntry` だったが、PR B で `reason` フィールドを `skipped` 側のみに追加する都合で継承を切り、独立 interface に。

#### ExtremesSnapshot

保有期間中の最高値・最安値スナップショット。MFE/MAE 算出（`Position.applyExtremes`）の入力。

```ts
interface ExtremesSnapshot {
  readonly highest: Price
  readonly lowest: Price
}
```

**Note (interface ≠ VO)**: 既存 `ExitExecution.closePosition` が structural type `{ highest: Price; lowest: Price }` を期待しているため、互換性維持で interface 形を採用する。VO 三条件（private constructor / equals / static factory）への class 昇格は現状不要と判断（運用上問題が顕在化した時点で再評価）。

**Note (記録される Price の意味)**:

- tick モード（live / `ExitDispatcher` 経路）: BUY ポジションは bid、SELL ポジションは ask の decisive 価格
- OHLC モード（backtest）: 足の high / low を BUY/SELL に依存せず記録（`ExtremeTracker.updateOhlc` 経由）

#### PositionExtremesPort

`ExitDispatcher` に注入する Port。`PositionExtremesUpdater` が実装する。

```ts
interface PositionExtremesPort {
  find(positionId: PositionId): ExtremesSnapshot | undefined  // 未追跡時は undefined
  remove(positionId: PositionId): void  // 冪等
}
```

**Note (Reader/Writer 分離)**: 更新責務（`update`）は本 Port に含めない（`PositionExtremesUpdater` 経由）。`ExitDispatcher` は本 interface のみに依存し、具象 Updater を知らない。

**Note (Optional 返却の意図)**: `find` Optional 返却は「順序契約違反を throw で表現しない」運用観点を優先した設計。Tell-Don't-Ask 完全準拠（`findOrSkip(positionId, onSkip): void` 等）への移行は現状不要と判断（運用上 ExitDispatcher の `if (!extremes)` 分岐で十分に observable）。

---

## 4. Javaコード例（代表的なもの3つ）

セクション3に掲載したPrice、CurrencyPair、Tickのコード例を代表例とします。

共通パターンをまとめると以下の通りです。

```
private constructor + static factory method + equals + hashCode + toString
```

**なぜこのパターンか:**

1. `private constructor` -- new演算子での直接生成を禁止。必ずfactory methodを通す
2. `static factory method` -- バリデーション付き。不正値は存在できない
3. `equals` + `hashCode` -- 値で等価比較。HashMapのキーにも使える
4. `toString` -- デバッグ・ログ用。ドメインの言葉で表現する

---

## 5. TypeScript実装ノート

### Javaとの主な違い

| Java | TypeScript | 対応策 |
|---|---|---|
| BigDecimal | なし | `big.js`ライブラリを使う |
| enum（メソッド付き） | なし | Union Typeまたはclassで代替 |
| `equals()` / `hashCode()` | なし | 手動で`equals()`メソッドを実装 |
| `private constructor` | `private constructor` | そのまま使える |
| value classの不変性 | `readonly`フィールド | `readonly`を徹底する |

### branded typeパターン

TypeScriptではclassを作らずに型安全性を確保する方法があります。

```typescript
// branded type: stringだがCurrencyPairとして型チェックされる
type CurrencyPair = string & { readonly __brand: 'CurrencyPair' };

function createCurrencyPair(value: string): CurrencyPair {
    const allowed = ['USD_JPY', 'EUR_JPY', 'GBP_JPY'];
    if (!allowed.includes(value)) {
        throw new Error(`未対応の通貨ペア: ${value}`);
    }
    return value as CurrencyPair;
}
```

branded typeはclass方式より軽量ですが、メソッド（`equals()`等）を持てません。
単純な値（CurrencyPair, BuySell等）にはbranded type、振る舞いが必要なもの（Price, Tick等）にはclassを使い分けるのが現実的です。

### big.jsの使い方

```typescript
import Big from 'big.js';

class Price {
    private constructor(private readonly value: Big) {}

    static of(value: string): Price {
        const v = new Big(value);
        if (v.lte(0)) {
            throw new Error(`価格は正の数: ${value}`);
        }
        return new Price(v);
    }

    minus(other: Price): Price {
        return new Price(this.value.minus(other.value));
    }

    equals(other: Price): boolean {
        return this.value.eq(other.value);
    }

    toString(): string { return this.value.toFixed(); }
}
```

---

## 6. 設計憲法（VO とドメインの不変条件）

> Issue #51 PositionManager 設計を通じて確立した、ドメイン VO に対する厳守ルール。**コードレビュー・設計レビュー時のチェックリストとしても使う**。

---

### 6.1 浮動小数誤差（Big 徹底）

ドメインの計算経路は `Big`（big.js）で閉じる。`toNumber()` / `toString()` は**再計算の入力にしない**。`Big → number` への変換は **`Lot.of(number)` のような VO 境界で最終 1 回**に限定する。

- 違反例: `Big` を `toNumber()` でいったん `number` に落として比較・乗算する
- 正例: `clamped = rounded.lt(MIN) ? MIN : rounded.gt(MAX) ? MAX : rounded` のように `Big` 同士で完結させる
- 例外: `Lot` は整数 VO（100〜500,000）のため `new Big(lot.toNumber())` 経由を許容（将来 `Lot.toBig()` を生やせば完全遵守）

### 6.2 エラー階層

VO の不変条件違反は `throw new Error(...)` を投げる。文言にはドメイン情報（不変条件名、入力値、関連する VO）を含める。**将来 `DomainValidationError` 等の専用例外階層に移行する余地**を残しておく。

### 6.3 `Balance` / `AvailableBalance` 分岐

`Balance` は「純残高（GMO の `marginBalance` 相当）」、`AvailableBalance` は「利用可能残高（含み損益込み、`availableAmount` 由来）」。両者は意味が違うため、必要が出た時点で **`AvailableBalance` を別 VO として切り出す**（policies.md 4.4 P4）。`Balance` 自体に「フォールバックかどうか」「利用可能かどうか」のメタは持たせない。

### 6.4 テスト戦略

各 VO で**境界値・例外・等価性・不変性**を必ずテストする。

- 境界値: `MIN - 1` / `MIN` / `MAX` / `MAX + 1`
- 例外: 不変条件違反の `throw` 確認
- 等価性: `equals` の対称性・推移性
- 不変性: 生成後にフィールドを書き換えようとして TypeScript の型エラー / `readonly` 違反になることを確認

### 6.5 `equals` と hashCode

VO は値で等価判定する。`Map` のキーに使う場合は `hashCode` 相当（JavaScript では `value` プロパティを `string` キーに使う）を保証する必要がある。**`StrategyName` は issue #130 で branded string 化し、`of()`（= `StrategyName()`）が毎回 `new` する class 実装をやめた**（N-C1 解消）。branded string は値そのものが `===` 等価かつ `Map` キーとして安定に機能するため、`Map<StrategyName, X>` を直接使ってよい（`StrategyNameValue` への詰め替えは不要だが、後方互換のため既存の `Map<StrategyNameValue, X>` 保持はそのまま許容）。

### 6.6 `StrategyName` branded string

`StrategyName` は `'SMA_CROSS' | 'RSI_REVERSAL' | 'SMA_DISTANCE' | 'WICK_REVERSAL'` の固定 4 値（戦略数は動的に拡張可能。追加は `VALID_NAMES` への追記のみ）。**演算を持たない識別子的 VO のため branded string で表現する**（`CurrencyPair` と同じ棲み分け / 6.5・「branded type パターン」節と連動。issue #130 で class から移行）。

- 生成: `StrategyName(value)`（`StrategyName.of(value)` は後方互換の別名）。ホワイトリスト外は実行時 throw
- 定数: `StrategyName.SMA_CROSS` 等（function と namespace のマージで提供）
- 等価: branded string ゆえ値そのものが `===` 等価。`strategyNameEquals(a, b)` を比較関数として用意（`currencyPairEquals` と同じ前例）
- `Map` キー: 値が `===` 等価なので `Map<StrategyName, X>` を直接使ってよい（N-C1 解消）
- 文字列化: 値そのものが string のため `String(name)` / テンプレートリテラルでそのまま使える。`.value` プロパティは持たない（6.11 のシリアライズは branded string なら値を直接出力）

### 6.7 domain VO は null を返さない

ドメイン層の VO・ドメインサービスは `null` を返さない。取得失敗は throw、「値がない」は専用 VO（`DoNothing`）。

- `Rate` / `Balance.freshNow()` は throw
- `LotAllocation.ratioOf(strategy)` は `Ratio.zero()` を返す（null ではない）
- port 層は例外的に `null` 許容（`BalancePort.current(): Balance | null` は API 失敗時 null。application 層で fallback）

### 6.8 `Pips` と `Rate` の pip 精度連携

`Pips` の単位は通貨ペアによって異なる（クロス円 = 0.01、EUR_USD = 0.0001）。`Rate.pipDifference(other)` は内部で `CurrencyPair.pipScale()` を使って Pips に変換する（issue #131 で `pipScale()` 追加）。**Pips を `number` で直接扱わない**。

### 6.9 `Rate.freshNow()` 運用

`Rate` VO 自体は「取得手段」を知らない。鮮度判定は `RatePort` 実装が担う。`RatePort.currentFresh(pair)` は内部で `Rate.isFreshEnough(now, maxAge)` を呼び、古ければ throw（古レート発注事故の防止）。`maxAge` の閾値は別 issue で確定。

### 6.10 `LotAllocation` / `StrategyLots` キー順序非依存

`Map` を API 境界に出さない。呼び出し側が `for...of` で順序依存のロジックを書けないようにする。

- ❌ `apply(): Map<StrategyName, Lot>`（生 Map 露出）
- ✅ `apply(): StrategyLots`（VO 経由で `lotOf` / `strategies` / `totalLot` を提供）

### 6.11 シリアライズ戦略

ログ・アラート・JSON シリアライズで VO を文字列化する際は、ドメイン語彙で出力する。

- `strategy: position.strategyName` → `'SMA_CROSS'`（branded string ゆえ値そのものが文字列。#130）
- `pair: pair.toString()` → `'USD_JPY'`
- `lot: lot.toString()` → `'7800'`（数値ではなく VO の `toString()` 経由で）

実装例（policies.md 4.1）:

```typescript
this.alertPort.notify('warn', 'signal dropped due to TTL', {
  age,
  ttl: this.ttlMs,
  strategy: head.command.strategyName,
  pair: head.command.pair.toString(),
});
```

---

## 設計メモ

### なぜstringではなくCurrencyPairを作るのか

`string`は何でも入ります。`"HELLO_WORLD"`も`""`も入ります。
`CurrencyPair`にはGMO FXが対応する通貨ペアしか入りません。

これは単なる型の話ではありません。
`CurrencyPair`を受け取る関数は、引数のバリデーションが不要になります。
型が正しければ値も正しい。この保証がコードベース全体に波及します。

バリデーションが1箇所（factory method）に集約され、それ以降はどこでも安心して使える。
これが値オブジェクトの最大の価値です。

### FormingCandleは値オブジェクトか

厳密には違います。`update()`で状態が変わるため、不変ではありません。
しかし「足を組み立てている途中」というドメイン概念を型で表現している点では、値オブジェクトの精神を受け継いでいます。
`confirm()`で不変のConfirmedCandleに変換される設計が、この二面性を解決しています。

### DoNothingがnullより優れている理由

nullは「値がない」です。DoNothingは「何もしないと判断した」です。
NullPointerExceptionは起きません。型システムが「判定結果は必ずEntryCommandかDoNothingのどちらか」と保証します。
ログにも`"DoNothing"`と出力できます。nullでは何も出力されません。
