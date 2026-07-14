import type { DetectedSignals } from '../rule/DetectedSignals.js';
import type { OpenPositions } from '../position/OpenPositions.js';
import type { Balance } from '../Balance.js';
import { currencyPairEquals, quote, type CurrencyPair } from '../market/CurrencyPair.js';

/**
 * AllocationPolicy.decide() の入力を束ねるパラメータオブジェクト。
 *
 * - `pair`: 配分判断対象の通貨ペア。Policy は currentPositions のうち本 pair に紐づく
 *   保有戦略のみを抑制対象にする（multi-pair 時の異 pair 同戦略の誤抑制防止）。
 * - `detectedSignals`: 検知された戦略集合
 * - `currentPositions`: 現在の保有ポジション（pair 跨ぎ全体。Policy 側で本 pair 限定に絞る）
 * - `balance`: 利用可能残高（含み損益込み、`BalancePort.availableAmount()` 由来）
 *
 * 不変条件: `balance.toMoney().currencyCode() === quote(pair)`。
 * 異 quote 通貨の残高で配分判断するのはドメイン上ナンセンスなので生成時に弾く。
 *
 * 設計書: docs/design/value-objects.md AllocationContext 章。
 *
 * Note (型ねじれ / M-N1, P4):
 * 現状 `balance` の型は純残高型 `Balance` だが、PositionManager から渡されるのは
 * 利用可能残高（含み損益込み）。`AvailableBalance` 切り出しまでは運用ガード
 * （PositionManager 側で availableAmount() を渡す責務）に委ねる。
 */
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

  pair(): CurrencyPair {
    return this.pairValue;
  }

  detectedSignals(): DetectedSignals {
    return this.detectedSignalsValue;
  }

  currentPositions(): OpenPositions {
    return this.currentPositionsValue;
  }

  balance(): Balance {
    return this.balanceValue;
  }

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
