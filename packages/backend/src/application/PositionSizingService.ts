import type { BalancePort } from '../port/BalancePort.js';
import type { RatePort } from '../port/RatePort.js';
import type { LotPolicy } from '../domain/position/LotPolicy.js';
import { Balance } from '../domain/Balance.js';
import { MaintenanceRatio } from '../domain/position/MaintenanceRatio.js';
import { MarginRate } from '../domain/position/MarginRate.js';
import { LotDecisionInput } from '../domain/position/LotDecisionInput.js';
import type { CurrencyPair } from '../domain/market/CurrencyPair.js';
import type { Lot } from '../domain/position/Lot.js';
import { SizingResult } from '../domain/position/SizingResult.js';
import { RatePortError } from '../domain/error/RatePortError.js';

/**
 * 単一戦略の基準 Lot を算出する application 層のサービス。
 *
 * Port を組み立てて `LotPolicy.decide()` を呼ぶ薄い orchestrator。
 * 戦略配分（複数戦略への割り当て）は `PositionManager` の責務（次フェーズ）。
 *
 * 通常経路（`executeSizing` / `execute`）と発注直前の鮮度保証経路（`executeWithFresh`）を分ける:
 *   - `executeSizing(pair)`: `BalancePort.current()` をフォールバック付きで使う通常サイジング。
 *     `SizingResult`（lot / rate / requiredMargin）を返す
 *   - `execute(pair)`: `executeSizing(pair).lot()` の薄いラッパ（互換用）
 *   - `executeWithFresh(pair)`: `BalancePort.freshNow()` で鮮度を保証し、`SizingResult` で
 *     lot / rate / requiredMargin を束ねて返す（NH-2: rate 二重取得を回避）
 *
 * 設計書: docs/design/position-manager/policies.md 1.4 / 1.5 / 1.7。
 */
export class PositionSizingService {
  constructor(
    private readonly balancePort: BalancePort,
    private readonly ratePort: RatePort,
    private readonly lotPolicy: LotPolicy,
    private readonly fallbackBalance: Balance,
    private readonly target: MaintenanceRatio,
    private readonly marginRate: MarginRate,
  ) {}

  /**
   * 通常のサイジング（キャッシュ残高 OK）— `Lot` のみを返す薄いラッパ。
   *
   * 内部的には `executeSizing(pair).lot()` と等価。Rule から呼ぶ最小経路として残す。
   */
  execute(pair: CurrencyPair): Lot {
    return this.executeSizing(pair).lot();
  }

  /**
   * 通常のサイジング（キャッシュ残高 OK）— `SizingResult` を返す。
   * Rule 発火時の基準 Lot + 必要証拠金算出に使う（policies.md 3.3.1 P10 の requiredMargin 充填）。
   *
   * 残高: `current()` が null なら `fallbackBalance` を使う。
   * レート: `currentOf()` が null（初回 tick 未到着）なら `RatePortError.notYetAvailable` を throw。
   *
   * `executeWithFresh` との差分:
   *   - 残高は `current()`（cached）。鮮度保証なし
   *   - レートは `currentOf()`（cached）。鮮度保証なし
   *   - `requiredMargin` 計算は `SizingResult.of()` に集約（NH-2: rate を閉じ込める）
   */
  executeSizing(pair: CurrencyPair): SizingResult {
    const balance = this.balancePort.current() ?? this.fallbackBalance;
    const rate = this.ratePort.currentOf(pair);
    if (rate === null) {
      throw RatePortError.notYetAvailable(pair);
    }
    const input = LotDecisionInput.of(pair, balance, rate, this.target, this.marginRate);
    const lot = this.lotPolicy.decide(input);
    return SizingResult.of(lot, rate, this.marginRate);
  }

  /**
   * 発注直前の鮮度保証サイジング。
   * 取れなかった場合は fallback せず throw する（エントリーは中止）。
   *
   * 戻り値の `SizingResult` には決定時の rate / requiredMargin が閉じ込められている。
   * `PositionManager` は同一 tick 内で `RatePort.currentFresh` を再度呼ばず、ここで取った
   * rate を `EntryCommand` 構築に流用する（NH-2 の核心）。
   */
  async executeWithFresh(pair: CurrencyPair): Promise<SizingResult> {
    const balance = await this.balancePort.freshNow();
    const rate = this.ratePort.currentFresh(pair);
    const input = LotDecisionInput.of(pair, balance, rate, this.target, this.marginRate);
    const lot = this.lotPolicy.decide(input);
    return SizingResult.of(lot, rate, this.marginRate);
  }
}
