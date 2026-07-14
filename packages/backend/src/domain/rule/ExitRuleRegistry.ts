import type { ExitRule } from './ExitRule.js';
import type { StrategyName, StrategyNameValue } from './StrategyName.js';
import { MissingExitRuleError } from '../error/MissingExitRuleError.js';

/**
 * 戦略名と ExitRule のペアを保持するファーストクラスコレクション。
 * `ExitDispatcher` が戦略別 lookup を行うための domain VO。
 *
 * Note (入力形 / D3):
 *   `of()` はタプル配列を受け取る。`Map<StrategyName, ExitRule>` 入力にしないのは、
 *   #130 未完で StrategyName が class かつ of() が毎回 new するため、
 *   JS の参照同値で重複検知が機能しないため（タプル配列で受けて内部で .value 同値で検知する）。
 *   #130 完了後は Map 入力へ書き換え可能。
 *
 * Note (lookup throw 契約 / C2):
 *   `ruleFor` は未登録の戦略を引いたとき `MissingExitRuleError` を throw する。
 *   既存パターン `RatePort.currentFresh` と同様、動詞そのもの + JSDoc で throw 契約を明示する。
 *
 * 設計書: docs/design/position-manager/step8-brief.md 5.1。
 */
export class ExitRuleRegistry {
  private constructor(private readonly byStrategy: ReadonlyMap<StrategyNameValue, ExitRule>) {}

  /**
   * 戦略と ExitRule のペアからレジストリを構築する。
   * 同一戦略の重複登録は branded string の同値（`===`）で検知して throw する。
   */
  static of(entries: ReadonlyArray<readonly [StrategyName, ExitRule]>): ExitRuleRegistry {
    const map = new Map<StrategyNameValue, ExitRule>();
    for (const [name, rule] of entries) {
      if (map.has(name)) {
        throw new Error(`ExitRuleRegistry: 重複登録 "${name}"`);
      }
      map.set(name, rule);
    }
    return new ExitRuleRegistry(map);
  }

  /**
   * 戦略に対応する ExitRule を返す。未登録時は undefined。
   * フロー制御で使うのはこちら（Dispatcher の通常経路）。
   */
  findRule(strategy: StrategyName): ExitRule | undefined {
    return this.byStrategy.get(strategy);
  }

  /**
   * 戦略に対応する ExitRule を返す。未登録時は MissingExitRuleError を throw。
   * 「絶対あるべきところで無かった」ときの最後の防壁。
   * 主に起動時 fail-fast 検証や明示的にエラー型で扱いたい呼び出し元向け。
   * @throws MissingExitRuleError 未登録の戦略を指定した場合
   */
  ruleFor(strategy: StrategyName): ExitRule {
    const rule = this.byStrategy.get(strategy);
    if (!rule) throw MissingExitRuleError.notRegistered(strategy);
    return rule;
  }

  /** 指定戦略が登録されているか。 */
  has(strategy: StrategyName): boolean {
    return this.byStrategy.has(strategy);
  }

  /** 登録済みの戦略名集合（読み取り専用）。 */
  registeredStrategies(): ReadonlySet<StrategyNameValue> {
    return new Set(this.byStrategy.keys());
  }
}
