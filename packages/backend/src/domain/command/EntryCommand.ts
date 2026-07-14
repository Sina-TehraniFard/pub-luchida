import { CurrencyPair } from '../market/CurrencyPair.js';
import { BuySell } from '../market/BuySell.js';
import { Lot } from '../position/Lot.js';
import { ConvictionScore } from '../market/ConvictionScore.js';
import { EntryReason } from './EntryReason.js';
import { StrategyName } from '../rule/StrategyName.js';
import { EntrySnapshot } from '../market/snapshot/EntrySnapshot.js';
import { Money } from '../Money.js';

/**
 * エントリー命令。
 * EntryRule が「今エントリーすべき」と判断したときに返す。
 * Action 層がこれを受け取り、実際に注文を出す。
 *
 * `requiredMargin` は発注に必要な証拠金の事前計算値（JPY）。
 * `EntryQueue.reservedMargin()` で未発注シグナルの合計証拠金見込みを算出する際、
 * 保持済みの値を合算するだけで済むよう、生成時点で確定させて持たせる
 * （docs/design/position-manager/policies.md 3.3.1 参照）。
 */
export class EntryCommand {
  private constructor(
    readonly pair: CurrencyPair,
    readonly buySell: BuySell,
    readonly lot: Lot,
    readonly reason: EntryReason,
    readonly convictionScore: ConvictionScore,
    readonly strategyName: StrategyName,
    readonly entrySnapshot: EntrySnapshot,
    readonly requiredMargin: Money,
  ) {}

  static of(params: {
    pair: CurrencyPair;
    buySell: BuySell;
    lot: Lot;
    reason: EntryReason;
    convictionScore: ConvictionScore;
    strategyName: StrategyName;
    entrySnapshot: EntrySnapshot;
    requiredMargin: Money;
  }): EntryCommand {
    // requiredMargin は非負必須（証拠金は概念的に 0 円以上）。
    // バックテスト経路では 0 円を許容（BacktestSizingResult.of は requiredMargin=0 固定）。
    if (params.requiredMargin.isNegative()) {
      throw new Error(
        `EntryCommand.requiredMargin は非負必須: ${params.requiredMargin.toString()}`,
      );
    }
    return new EntryCommand(
      params.pair,
      params.buySell,
      params.lot,
      params.reason,
      params.convictionScore,
      params.strategyName,
      params.entrySnapshot,
      params.requiredMargin,
    );
  }
}
