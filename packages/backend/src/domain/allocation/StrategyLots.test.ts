import { describe, it, expect } from 'vitest';
import { StrategyLots } from './StrategyLots.js';
import { Lot } from '../position/Lot.js';
import { TotalUnits } from '../position/TotalUnits.js';
import { Ratio } from '../Ratio.js';
import { StrategyName, type StrategyNameValue } from '../rule/StrategyName.js';

describe('StrategyLots', () => {
  describe('fromAllocation()', () => {
    it('SMA_CROSS=0.4 / RSI_REVERSAL=0.6 / baseLot=10000 で各戦略に按分された Lot が入る', () => {
      // Given: 2 戦略への按分比率と基準 Lot
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.of(0.4)],
        ['RSI_REVERSAL', Ratio.of(0.6)],
      ]);
      const baseLot = Lot.of(10_000);

      // When: fromAllocation で StrategyLots を生成
      const lots = StrategyLots.fromAllocation(ratios, baseLot);

      // Then: 各戦略の Lot が按分後の値
      expect(lots.lotOf(StrategyName.SMA_CROSS)?.equals(Lot.of(4_000))).toBe(true);
      expect(lots.lotOf(StrategyName.RSI_REVERSAL)?.equals(Lot.of(6_000))).toBe(true);
    });

    it('Ratio.zero() で抑制された戦略は含まれない', () => {
      // Given: RSI_REVERSAL を 0 で抑制
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.of(0.5)],
        ['RSI_REVERSAL', Ratio.zero()],
      ]);
      const baseLot = Lot.of(10_000);

      // When: fromAllocation で StrategyLots を生成
      const lots = StrategyLots.fromAllocation(ratios, baseLot);

      // Then: SMA_CROSS のみ含まれ、RSI_REVERSAL は除外される
      expect(lots.lotOf(StrategyName.SMA_CROSS)?.equals(Lot.of(5_000))).toBe(true);
      expect(lots.lotOf(StrategyName.RSI_REVERSAL)).toBeNull();
      expect(lots.strategies()).toHaveLength(1);
    });

    it('全戦略が抑制されると、空の StrategyLots が返る', () => {
      // Given: 全戦略 0
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.zero()],
        ['RSI_REVERSAL', Ratio.zero()],
        ['SMA_DISTANCE', Ratio.zero()],
        ['WICK_REVERSAL', Ratio.zero()],
      ]);
      const baseLot = Lot.of(10_000);

      // When: fromAllocation で StrategyLots を生成
      const lots = StrategyLots.fromAllocation(ratios, baseLot);

      // Then: 空
      expect(lots.isEmpty()).toBe(true);
      expect(lots.strategies()).toEqual([]);
    });

    it('単一戦略への 100% 配分も生成できる', () => {
      // Given: SMA_CROSS のみに 1.0
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.one()],
      ]);
      const baseLot = Lot.of(10_000);

      // When: fromAllocation で StrategyLots を生成
      const lots = StrategyLots.fromAllocation(ratios, baseLot);

      // Then: SMA_CROSS のみが baseLot 全量で含まれる
      expect(lots.lotOf(StrategyName.SMA_CROSS)?.equals(Lot.of(10_000))).toBe(true);
      expect(lots.strategies()).toHaveLength(1);
    });
  });

  describe('lotOf()', () => {
    it('含まれる戦略は対応する Lot を返す', () => {
      // Given: SMA_CROSS=0.4 / RSI_REVERSAL=0.6
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.of(0.4)],
        ['RSI_REVERSAL', Ratio.of(0.6)],
      ]);
      const lots = StrategyLots.fromAllocation(ratios, Lot.of(10_000));

      // When / Then: 含まれる戦略は Lot を返す
      expect(lots.lotOf(StrategyName.SMA_CROSS)?.equals(Lot.of(4_000))).toBe(true);
    });

    it('含まれない戦略には null を返す', () => {
      // Given: SMA_CROSS のみの StrategyLots
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.one()],
      ]);
      const lots = StrategyLots.fromAllocation(ratios, Lot.of(10_000));

      // When / Then: 配分対象外の戦略は null
      expect(lots.lotOf(StrategyName.RSI_REVERSAL)).toBeNull();
      expect(lots.lotOf(StrategyName.SMA_DISTANCE)).toBeNull();
      expect(lots.lotOf(StrategyName.WICK_REVERSAL)).toBeNull();
    });
  });

  describe('strategies()', () => {
    it('配分対象の戦略一覧を返す（抑制戦略は含まれない）', () => {
      // Given: SMA_CROSS / SMA_DISTANCE のみ非ゼロ
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.of(0.4)],
        ['RSI_REVERSAL', Ratio.zero()],
        ['SMA_DISTANCE', Ratio.of(0.6)],
        ['WICK_REVERSAL', Ratio.zero()],
      ]);
      const lots = StrategyLots.fromAllocation(ratios, Lot.of(10_000));

      // When: strategies() で取得
      const names = lots.strategies().map((s) => s);

      // Then: 抑制されていない 2 戦略のみ
      expect(names).toHaveLength(2);
      expect(names).toContain('SMA_CROSS');
      expect(names).toContain('SMA_DISTANCE');
      expect(names).not.toContain('RSI_REVERSAL');
      expect(names).not.toContain('WICK_REVERSAL');
    });
  });

  describe('totalLot()', () => {
    it('SMA_CROSS=4000 + RSI_REVERSAL=6000 で TotalUnits.of("10000")', () => {
      // Given: 2 戦略への按分
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.of(0.4)],
        ['RSI_REVERSAL', Ratio.of(0.6)],
      ]);
      const lots = StrategyLots.fromAllocation(ratios, Lot.of(10_000));

      // When: totalLot()
      const total = lots.totalLot();

      // Then: 合計 10,000
      expect(total.equals(TotalUnits.of('10000'))).toBe(true);
    });

    it('4 戦略 × Lot(200000) = TotalUnits.of("800000")（単一 Lot 上限超のシナリオ）', () => {
      // Given: 4 戦略に均等配分（baseLot=800,000 はそのまま不可なので個別構築）
      // fromAllocation は baseLot=Lot.of(...) を要求し、Lot は 500,000 上限なので、
      // ratio×baseLot=200,000 になる組み合わせを使う: 0.25 × 800,000 ... ただし baseLot は 500,000 上限。
      // よって 0.4 × 500,000 = 200,000 で 4 戦略すべて Lot(200,000) を作る。
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.of(0.4)],
        ['RSI_REVERSAL', Ratio.of(0.4)],
        ['SMA_DISTANCE', Ratio.of(0.4)],
        ['WICK_REVERSAL', Ratio.of(0.4)],
      ]);
      const lots = StrategyLots.fromAllocation(ratios, Lot.of(500_000));

      // When: totalLot()
      const total = lots.totalLot();

      // Then: 合計 800,000（単一 Lot 上限 500,000 を超える）
      expect(total.equals(TotalUnits.of('800000'))).toBe(true);
      expect(total.isExceedingSingleLotLimit()).toBe(true);
    });

    it('空の StrategyLots は TotalUnits.zero()', () => {
      // Given: 全戦略抑制
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.zero()],
      ]);
      const lots = StrategyLots.fromAllocation(ratios, Lot.of(10_000));

      // When / Then: 0
      expect(lots.totalLot().equals(TotalUnits.zero())).toBe(true);
    });
  });

  describe('equals()', () => {
    it('同一構成（戦略集合と各 Lot が一致）で true', () => {
      // Given: 同じ ratios / baseLot から 2 つ生成
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.of(0.4)],
        ['RSI_REVERSAL', Ratio.of(0.6)],
      ]);
      const a = StrategyLots.fromAllocation(ratios, Lot.of(10_000));
      const b = StrategyLots.fromAllocation(ratios, Lot.of(10_000));

      // When / Then
      expect(a.equals(b)).toBe(true);
    });

    it('異なる戦略集合で false', () => {
      // Given: SMA_CROSS のみ vs SMA_CROSS+RSI_REVERSAL
      const a = StrategyLots.fromAllocation(
        new Map<StrategyNameValue, Ratio>([['SMA_CROSS', Ratio.one()]]),
        Lot.of(10_000),
      );
      const b = StrategyLots.fromAllocation(
        new Map<StrategyNameValue, Ratio>([
          ['SMA_CROSS', Ratio.of(0.4)],
          ['RSI_REVERSAL', Ratio.of(0.6)],
        ]),
        Lot.of(10_000),
      );

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('size 違い（片方の戦略が抑制されて減る）で false', () => {
      // Given: 2 戦略 vs 1 戦略
      const a = StrategyLots.fromAllocation(
        new Map<StrategyNameValue, Ratio>([
          ['SMA_CROSS', Ratio.of(0.4)],
          ['RSI_REVERSAL', Ratio.of(0.6)],
        ]),
        Lot.of(10_000),
      );
      const b = StrategyLots.fromAllocation(
        new Map<StrategyNameValue, Ratio>([
          ['SMA_CROSS', Ratio.of(0.4)],
          ['RSI_REVERSAL', Ratio.zero()],
        ]),
        Lot.of(10_000),
      );

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('一致するキー集合で値違い（baseLot 違い）で false', () => {
      // Given: 同じ戦略集合だが Lot 値が違う
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.of(0.4)],
        ['RSI_REVERSAL', Ratio.of(0.6)],
      ]);
      const a = StrategyLots.fromAllocation(ratios, Lot.of(10_000));
      const b = StrategyLots.fromAllocation(ratios, Lot.of(20_000));

      // When / Then
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('戦略名=Lot 値の列挙形式で出力する', () => {
      // Given: 2 戦略
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.of(0.4)],
        ['RSI_REVERSAL', Ratio.of(0.6)],
      ]);
      const lots = StrategyLots.fromAllocation(ratios, Lot.of(10_000));

      // When
      const s = lots.toString();

      // Then: 各戦略の表示が含まれる
      expect(s).toContain('SMA_CROSS=4000');
      expect(s).toContain('RSI_REVERSAL=6000');
      expect(s.startsWith('StrategyLots(')).toBe(true);
      expect(s.endsWith(')')).toBe(true);
    });

    it('空の StrategyLots は "StrategyLots()"', () => {
      // Given: 全戦略抑制
      const lots = StrategyLots.fromAllocation(
        new Map<StrategyNameValue, Ratio>([['SMA_CROSS', Ratio.zero()]]),
        Lot.of(10_000),
      );

      // When / Then
      expect(lots.toString()).toBe('StrategyLots()');
    });
  });

  describe('isEmpty()', () => {
    it('配分対象が 0 件で true', () => {
      // Given: 全戦略抑制
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.zero()],
        ['RSI_REVERSAL', Ratio.zero()],
      ]);
      const lots = StrategyLots.fromAllocation(ratios, Lot.of(10_000));

      // When / Then: 空
      expect(lots.isEmpty()).toBe(true);
    });

    it('配分対象が 1 件以上で false', () => {
      // Given: 1 戦略のみ
      const ratios = new Map<StrategyNameValue, Ratio>([
        ['SMA_CROSS', Ratio.one()],
      ]);
      const lots = StrategyLots.fromAllocation(ratios, Lot.of(10_000));

      // When / Then: 非空
      expect(lots.isEmpty()).toBe(false);
    });
  });
});
