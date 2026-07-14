import { SMA } from 'trading-signals';
import type {
  SmaCalculator,
  SmaCalculatorFactory,
} from '@luchida/backend/domain/market/indicator/SmaCalculator.js';

/**
 * BT 用の SmaCalculator 実装。
 *
 * 本体の adapter 層にある TradingSignalsSmaCalculatorFactory と
 * 同じ trading-signals ライブラリを使う。共有カーネル原則により
 * adapter 層は import できないため、BT 側で独自に実装する。
 * ライブラリが同一なので計算結果は本体と一致する。
 */
class BacktestSmaCalculator implements SmaCalculator {
  private readonly sma: SMA;

  constructor(period: number) {
    this.sma = new SMA(period);
  }

  add(value: number): void {
    this.sma.add(value);
  }

  replace(value: number): void {
    this.sma.replace(value);
  }

  isStable(): boolean {
    return this.sma.isStable;
  }

  getResult(): number {
    return this.sma.getResult() as number;
  }
}

export class BacktestSmaCalculatorFactory implements SmaCalculatorFactory {
  create(period: number): SmaCalculator {
    return new BacktestSmaCalculator(period);
  }
}
