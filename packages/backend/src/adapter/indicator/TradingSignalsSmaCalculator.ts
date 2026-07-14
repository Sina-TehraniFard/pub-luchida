import { SMA } from 'trading-signals';
import { SmaCalculator, SmaCalculatorFactory } from '../../domain/market/indicator/SmaCalculator.js';

export class TradingSignalsSmaCalculator implements SmaCalculator {
  private readonly _sma: SMA;

  constructor(period: number) {
    this._sma = new SMA(period);
  }

  add(value: number): void {
    this._sma.add(value);
  }

  replace(value: number): void {
    this._sma.replace(value);
  }

  isStable(): boolean {
    return this._sma.isStable;
  }

  getResult(): number {
    return this._sma.getResult() as number;
  }
}

export class TradingSignalsSmaCalculatorFactory implements SmaCalculatorFactory {
  create(period: number): SmaCalculator {
    return new TradingSignalsSmaCalculator(period);
  }
}
