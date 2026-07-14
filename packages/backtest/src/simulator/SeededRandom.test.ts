import { describe, it, expect } from 'vitest';

import { SeededRandom } from './SeededRandom.js';

describe('SeededRandom', () => {
  describe('再現性', () => {
    it('同じ seed で同じ next() 系列を生成する', () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(42);

      const seq1 = Array.from({ length: 20 }, () => rng1.next());
      const seq2 = Array.from({ length: 20 }, () => rng2.next());

      expect(seq1).toEqual(seq2);
    });

    it('異なる seed で異なる next() 系列を生成する', () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(99);

      const seq1 = Array.from({ length: 20 }, () => rng1.next());
      const seq2 = Array.from({ length: 20 }, () => rng2.next());

      // 全要素が一致することはほぼない
      const allEqual = seq1.every((v, i) => v === seq2[i]);
      expect(allEqual).toBe(false);
    });
  });

  describe('nextGaussian() の分布検証', () => {
    it('平均が約0、標準偏差が約1（10000サンプル）', () => {
      const rng = new SeededRandom(12345);
      const samples = Array.from({ length: 10_000 }, () => rng.nextGaussian());

      const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
      const variance =
        samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples.length;
      const stddev = Math.sqrt(variance);

      expect(Math.abs(mean)).toBeLessThan(0.05);
      expect(Math.abs(stddev - 1)).toBeLessThan(0.05);
    });

    it('裾の分布が正規分布に近い（|x|>2 が約 4.5%、|x|>3 が約 0.3%）', () => {
      const rng = new SeededRandom(54321);
      const samples = Array.from({ length: 10_000 }, () => rng.nextGaussian());
      const n = samples.length;

      const beyond2 = samples.filter((v) => Math.abs(v) > 2).length / n;
      const beyond3 = samples.filter((v) => Math.abs(v) > 3).length / n;

      // 理論値: |x|>2 ≈ 4.55%, |x|>3 ≈ 0.27%
      expect(Math.abs(beyond2 - 0.0455)).toBeLessThan(0.02);
      expect(Math.abs(beyond3 - 0.0027)).toBeLessThan(0.02);
    });
  });
});
