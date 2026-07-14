import { SmaCrossEntryRule } from '@luchida/backend/domain/rule/sma-cross/SmaCrossEntryRule.js';
import { SmaCrossExitRule } from '@luchida/backend/domain/rule/sma-cross/SmaCrossExitRule.js';
import { FixedStopLossExitRule } from '@luchida/backend/domain/rule/shared/FixedStopLossExitRule.js';
import { FixedTakeProfitExitRule } from '@luchida/backend/domain/rule/shared/FixedTakeProfitExitRule.js';
import { TrailingTakeProfitExitRule } from '@luchida/backend/domain/rule/shared/TrailingTakeProfitExitRule.js';
import { Lot } from '@luchida/backend/domain/position/Lot.js';
import { BacktestSizingResult } from '@luchida/backend/domain/position/BacktestSizingResult.js';
import { durationMs } from '@luchida/backend/domain/market/TimeFrame.js';
import type { EntryRule } from '@luchida/backend/domain/rule/EntryRule.js';
import type { ExitRule } from '@luchida/backend/domain/rule/ExitRule.js';
import type { ParameterSet } from '../parameter/ParameterSet.js';
import { CompositeExitRule } from '@luchida/backend/domain/rule/shared/CompositeExitRule.js';
import { TimeFilteredEntryRule } from '@luchida/backend/domain/rule/shared/TimeFilteredEntryRule.js';
import { CrossStrengthFilterEntryRule } from '@luchida/backend/domain/rule/shared/CrossStrengthFilterEntryRule.js';
import { SmaDivergenceFilterEntryRule } from '@luchida/backend/domain/rule/shared/SmaDivergenceFilterEntryRule.js';
import { PriceBandFilterEntryRule } from '@luchida/backend/domain/rule/shared/PriceBandFilterEntryRule.js';
import { TimeWindowBlockEntryRule } from '@luchida/backend/domain/rule/shared/TimeWindowBlockEntryRule.js';
import { MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW } from '@luchida/backend/domain/rule/shared/midMonthJstLunchNonBojWindow.js';
import { TimedExitRule } from '@luchida/backend/domain/rule/shared/TimedExitRule.js';

export interface RulePair {
  entryRule: EntryRule;
  exitRule: ExitRule;
}

/**
 * ParameterSet から Rule インスタンスを生成する。
 * getLot は Runner から注入される（複利対応: equity に応じて動的に Lot を計算）。
 * 全パラメータは ParameterSet から読み取る。ハードコードしない。
 *
 * バックテストでは実際の証拠金チェックを行わないため、`requiredMargin` は 0 円固定で
 * EntryCommand に詰める（policies.md 3.3.1 の P10 確定方針との整合維持。本番経路では
 * `PositionSizingService.executeSizing` が rate × lot × marginRate を計算する）。
 */
export function createRules(ps: ParameterSet, getLot: () => Lot): RulePair {
  switch (ps.strategy) {
    case 'SMA_CROSS': {
      // === エントリールール ===
      const getSizing = () => BacktestSizingResult.of(getLot(), ps.pair);
      let entryRule: EntryRule = new SmaCrossEntryRule(ps.timeframe, getSizing);

      if (ps.minCrossStrengthPips != null && ps.minCrossStrengthPips > 0) {
        entryRule = new CrossStrengthFilterEntryRule(entryRule, ps.timeframe, ps.minCrossStrengthPips);
      }

      if (ps.maxDirectionalDivergencePct != null && ps.maxDirectionalDivergencePct > 0) {
        entryRule = new SmaDivergenceFilterEntryRule(entryRule, ps.timeframe, ps.maxDirectionalDivergencePct);
      }

      if (ps.priceBandFilter != null && (ps.priceBandFilter.minSellPrice != null || ps.priceBandFilter.maxBuyPrice != null)) {
        entryRule = new PriceBandFilterEntryRule(
          entryRule,
          ps.priceBandFilter.minSellPrice ?? null,
          ps.priceBandFilter.maxBuyPrice ?? null,
        );
      }

      if (ps.excludeMidMonthJstLunchNonBoj) {
        entryRule = new TimeWindowBlockEntryRule(entryRule, [MID_MONTH_JST_LUNCH_NON_BOJ_WINDOW]);
      }

      if (ps.excludeHoursUtc.length > 0) {
        entryRule = new TimeFilteredEntryRule(entryRule, new Set(ps.excludeHoursUtc));
      }

      // === エグジットルール（評価順序: SL → TP → 時間制限 → クロス決済） ===
      const exitRules: ExitRule[] = [new FixedStopLossExitRule(ps.stopLossPips)];

      if (ps.trailActivatePips != null && ps.trailWidthPips != null) {
        exitRules.push(new TrailingTakeProfitExitRule(ps.trailActivatePips, ps.trailWidthPips));
      } else if (ps.takeProfitPips !== null) {
        exitRules.push(new FixedTakeProfitExitRule(ps.takeProfitPips));
      }

      if (ps.maxHoldBars > 0) {
        exitRules.push(new TimedExitRule(ps.maxHoldBars, durationMs(ps.timeframe)));
      }

      // SMA クロス決済（常に最後）
      exitRules.push(new SmaCrossExitRule(ps.timeframe));

      return { entryRule, exitRule: new CompositeExitRule(exitRules) };
    }
    default:
      throw new Error(`未対応の戦略: ${(ps as ParameterSet).strategy}`);
  }
}

/**
 * ParameterSet からインジケーターの warmup に必要な足数を算出する。
 */
export function calcWarmupCount(ps: ParameterSet): number {
  switch (ps.strategy) {
    case 'SMA_CROSS':
      return Math.max(ps.shortPeriod, ps.longPeriod);
    default:
      throw new Error(`未対応の戦略: ${(ps as ParameterSet).strategy}`);
  }
}
