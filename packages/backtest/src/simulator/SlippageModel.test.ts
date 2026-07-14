import { describe, it, expect } from 'vitest';

import { Price } from '@luchida/backend/domain/market/Price.js';

import { SeededRandom } from './SeededRandom.js';
import { SlippageModel } from './SlippageModel.js';

// JPY ペアの pip unit（0.01）
const JPY_PIP_UNIT = 0.01;
// USD ペアの pip unit（0.0001）
const USD_PIP_UNIT = 0.0001;

describe('SlippageModel', () => {
  it('stddev=0 でスリッページなし（basePrice がそのまま返る）', () => {
    const rng = new SeededRandom(1);
    const model = new SlippageModel(0, rng, JPY_PIP_UNIT);

    const basePrice = Price.of('150.000');
    const result = model.applyTo(basePrice, 'BUY');

    expect(result.toString()).toBe(basePrice.toString());
  });

  it('BUY でスリッページが上方向（価格が増加）', () => {
    // 固定シードで100回試行し、常に basePrice 以上になることを確認
    const rng = new SeededRandom(2024);
    const model = new SlippageModel(0.3, rng, JPY_PIP_UNIT);

    const basePrice = Price.of('150.000');
    const basePriceNum = Number(basePrice.toString());

    for (let i = 0; i < 100; i++) {
      const result = model.applyTo(basePrice, 'BUY');
      expect(Number(result.toString())).toBeGreaterThanOrEqual(basePriceNum);
    }
  });

  it('SELL でスリッページが下方向（価格が減少）', () => {
    // 固定シードで100回試行し、常に basePrice 以下になることを確認
    const rng = new SeededRandom(2025);
    const model = new SlippageModel(0.3, rng, JPY_PIP_UNIT);

    const basePrice = Price.of('150.000');
    const basePriceNum = Number(basePrice.toString());

    for (let i = 0; i < 100; i++) {
      const result = model.applyTo(basePrice, 'SELL');
      expect(Number(result.toString())).toBeLessThanOrEqual(basePriceNum);
    }
  });

  it('同じ SeededRandom シードで同じスリッページ値（再現性）', () => {
    const basePrice = Price.of('150.000');

    const rng1 = new SeededRandom(777);
    const model1 = new SlippageModel(0.3, rng1, JPY_PIP_UNIT);
    const results1 = Array.from({ length: 10 }, () =>
      model1.applyTo(basePrice, 'BUY').toString(),
    );

    const rng2 = new SeededRandom(777);
    const model2 = new SlippageModel(0.3, rng2, JPY_PIP_UNIT);
    const results2 = Array.from({ length: 10 }, () =>
      model2.applyTo(basePrice, 'BUY').toString(),
    );

    expect(results1).toEqual(results2);
  });

  it('pipUnit 違い（JPY=0.01 vs USD=0.0001）でスリッページ量が正しく変換される', () => {
    // 同じ stddev=1.0 pips でも、JPY ペアと USD ペアでは実際の価格変動量が異なる
    // JPY: 1 pip = 0.01 → スリッページ幅も 0.01 単位
    // USD: 1 pip = 0.0001 → スリッページ幅も 0.0001 単位
    // 同じシードを使い、同じ pips 数でも価格変動が pipUnit の比率（100倍）分異なることを確認

    const seed = 9999;
    const stddevPips = 1.0;

    const rngJpy = new SeededRandom(seed);
    const modelJpy = new SlippageModel(stddevPips, rngJpy, JPY_PIP_UNIT);
    const jpyBase = Price.of('150.000');
    const jpyResult = modelJpy.applyTo(jpyBase, 'BUY');
    const jpySlippage = Math.abs(
      Number(jpyResult.toString()) - Number(jpyBase.toString()),
    );

    const rngUsd = new SeededRandom(seed);
    const modelUsd = new SlippageModel(stddevPips, rngUsd, USD_PIP_UNIT);
    const usdBase = Price.of('1.10000');
    const usdResult = modelUsd.applyTo(usdBase, 'BUY');
    const usdSlippage = Math.abs(
      Number(usdResult.toString()) - Number(usdBase.toString()),
    );

    // JPY スリッページ / USD スリッページ ≈ JPY_PIP_UNIT / USD_PIP_UNIT = 100
    // 同一 seed なので nextGaussian() の値も同じ → ratio = pipUnit 比率に一致
    const ratio = jpySlippage / usdSlippage;
    expect(ratio).toBeCloseTo(JPY_PIP_UNIT / USD_PIP_UNIT, 1);
  });
});
