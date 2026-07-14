import { describe, it, expect } from 'vitest';
import { LotAllocation } from './LotAllocation.js';
import { Ratio } from '../Ratio.js';
import { StrategyName } from '../rule/StrategyName.js';
import { Lot } from '../position/Lot.js';

describe('LotAllocation', () => {
  describe('of() 正常系', () => {
    it('2 戦略 0.4 + 0.6 = 1.0 で生成できる', () => {
      // Given: 2 戦略の比率合計 1.0
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(0.4)],
        [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
      ]);

      // When: 生成
      const alloc = LotAllocation.of(entries);

      // Then: 各戦略の比率が取得できる
      expect(alloc.ratioOf(StrategyName.SMA_CROSS).equals(Ratio.of(0.4))).toBe(true);
      expect(alloc.ratioOf(StrategyName.RSI_REVERSAL).equals(Ratio.of(0.6))).toBe(true);
    });

    it('4 戦略 0.25 × 4 = 1.0 で生成できる', () => {
      // Given: 4 戦略均等配分
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(0.25)],
        [StrategyName.RSI_REVERSAL, Ratio.of(0.25)],
        [StrategyName.SMA_DISTANCE, Ratio.of(0.25)],
        [StrategyName.WICK_REVERSAL, Ratio.of(0.25)],
      ]);

      // When: 生成
      const alloc = LotAllocation.of(entries);

      // Then: 4 戦略すべてに 0.25 が割り当てられる
      expect(alloc.strategies()).toHaveLength(4);
      expect(alloc.ratioOf(StrategyName.SMA_CROSS).equals(Ratio.of(0.25))).toBe(true);
      expect(alloc.ratioOf(StrategyName.WICK_REVERSAL).equals(Ratio.of(0.25))).toBe(true);
    });

    it('残余寄せ N=3: 0.3333333333 × 2 + 0.3333333334 で EPSILON 内なら成功', () => {
      // Given: N=3 の残余寄せパターン
      // 0.3333333333 × 2 + 0.3333333334 = 1.0000000000（最後で帳尻合わせ）
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of('0.3333333333')],
        [StrategyName.RSI_REVERSAL, Ratio.of('0.3333333333')],
        [StrategyName.SMA_DISTANCE, Ratio.of('0.3333333334')],
      ]);

      // When: 生成（EPSILON=1e-9 以内）
      const alloc = LotAllocation.of(entries);

      // Then: 例外なく生成され、各戦略の比率が保持される
      expect(alloc.strategies()).toHaveLength(3);
      expect(alloc.ratioOf(StrategyName.SMA_DISTANCE).equals(Ratio.of('0.3333333334'))).toBe(true);
    });
  });

  describe('of() 異常系', () => {
    it('合計 0.9（1.0 未満かつ allZero でない）でエラー', () => {
      // Given: 合計が 0.9
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(0.4)],
        [StrategyName.RSI_REVERSAL, Ratio.of(0.5)],
      ]);

      // When / Then: |0.9 - 1.0| = 0.1 > EPSILON
      expect(() => LotAllocation.of(entries)).toThrow(
        'LotAllocation の比率合計は 1.0 ± EPSILON',
      );
    });

    it('合計 1.1（EPSILON 超過）でエラー', () => {
      // Given: 合計が 1.1（Ratio 単独は <=1.0 なので分割して入れる）
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(0.5)],
        [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
      ]);

      // When / Then: |1.1 - 1.0| = 0.1 > EPSILON
      expect(() => LotAllocation.of(entries)).toThrow(
        'LotAllocation の比率合計は 1.0 ± EPSILON',
      );
    });

    it('同一 value の StrategyName は Map キーが等価なので入力 Map 段で 1 件に統合される（#130）', () => {
      // Given: 同じ value 'SMA_CROSS' を別経路で生成して 2 回登録。
      // StrategyName は branded string なので === 同一 → JS Map のキーが等価で後勝ち統合される。
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName('SMA_CROSS'), Ratio.of(0.4)],
        [StrategyName('SMA_CROSS'), Ratio.of(1)],
      ]);

      // Then: 入力 Map は 1 件（後勝ちで Ratio=1.0）に統合済みのため、合計 1.0 を満たし生成成功する。
      // class 実装では別インスタンスゆえ両方保持され合計乖離で落ちていたが、#130 で構造的に解消。
      expect(entries.size).toBe(1);
      const alloc = LotAllocation.of(entries);
      expect(alloc.ratioOf(StrategyName.SMA_CROSS).equals(Ratio.of(1))).toBe(true);
    });
  });

  describe('全ゼロ許容', () => {
    it('全戦略 Ratio.zero() で生成成功し isFullySuppressed=true', () => {
      // Given: 全戦略ゼロ比率
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.zero()],
        [StrategyName.RSI_REVERSAL, Ratio.zero()],
      ]);

      // When: 生成（合計 0.0 だが全ゼロなので許容）
      const alloc = LotAllocation.of(entries);

      // Then: 全抑制
      expect(alloc.isFullySuppressed()).toBe(true);
    });
  });

  describe('suppressed()', () => {
    it('戦略リストから suppressed LotAllocation を生成、全戦略の ratioOf が Ratio.zero()', () => {
      // Given: 抑制対象戦略
      const strategies = [StrategyName.SMA_CROSS, StrategyName.RSI_REVERSAL];

      // When: 全抑制
      const alloc = LotAllocation.suppressed(strategies);

      // Then: 各戦略の比率がゼロで、isFullySuppressed=true
      expect(alloc.ratioOf(StrategyName.SMA_CROSS).isZero()).toBe(true);
      expect(alloc.ratioOf(StrategyName.RSI_REVERSAL).isZero()).toBe(true);
      expect(alloc.isFullySuppressed()).toBe(true);
    });
  });

  describe('ratioOf()', () => {
    it('含まれる戦略は対応する Ratio を返す', () => {
      // Given: 2 戦略
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(0.4)],
        [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
      ]);
      const alloc = LotAllocation.of(entries);

      // When / Then: 0.4 が返る
      expect(alloc.ratioOf(StrategyName.SMA_CROSS).equals(Ratio.of(0.4))).toBe(true);
    });

    it('含まれない戦略は Ratio.zero() を返す', () => {
      // Given: SMA_CROSS と RSI_REVERSAL のみ
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(0.4)],
        [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
      ]);
      const alloc = LotAllocation.of(entries);

      // When / Then: 含まれない SMA_DISTANCE は zero
      expect(alloc.ratioOf(StrategyName.SMA_DISTANCE).isZero()).toBe(true);
    });
  });

  describe('isSuppressed()', () => {
    it('ゼロ比率の戦略で true', () => {
      // Given: SMA_CROSS=0、他で帳尻合わせ
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.zero()],
        [StrategyName.RSI_REVERSAL, Ratio.of(1.0)],
      ]);
      const alloc = LotAllocation.of(entries);

      // When / Then: SMA_CROSS は抑制されている
      expect(alloc.isSuppressed(StrategyName.SMA_CROSS)).toBe(true);
    });

    it('非ゼロ比率の戦略で false', () => {
      // Given
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(0.4)],
        [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
      ]);
      const alloc = LotAllocation.of(entries);

      // When / Then: SMA_CROSS は配分対象
      expect(alloc.isSuppressed(StrategyName.SMA_CROSS)).toBe(false);
    });

    it('含まれない戦略は true（zero と同じ挙動）', () => {
      // Given: SMA_CROSS / RSI_REVERSAL のみ
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(0.4)],
        [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
      ]);
      const alloc = LotAllocation.of(entries);

      // When / Then: 含まれない WICK_REVERSAL も「抑制」扱い
      expect(alloc.isSuppressed(StrategyName.WICK_REVERSAL)).toBe(true);
    });
  });

  describe('isFullySuppressed()', () => {
    it('全戦略ゼロで true', () => {
      // Given
      const alloc = LotAllocation.suppressed([
        StrategyName.SMA_CROSS,
        StrategyName.RSI_REVERSAL,
      ]);

      // When / Then
      expect(alloc.isFullySuppressed()).toBe(true);
    });

    it('1 つでも非ゼロで false', () => {
      // Given: SMA_CROSS のみ非ゼロ
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(1.0)],
        [StrategyName.RSI_REVERSAL, Ratio.zero()],
      ]);
      const alloc = LotAllocation.of(entries);

      // When / Then
      expect(alloc.isFullySuppressed()).toBe(false);
    });
  });

  describe('apply()', () => {
    it('SMA_CROSS=0.4, RSI_REVERSAL=0.6, baseLot=10000 で StrategyLots を返す', () => {
      // Given
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(0.4)],
        [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
      ]);
      const alloc = LotAllocation.of(entries);
      const baseLot = Lot.of(10_000);

      // When
      const lots = alloc.apply(baseLot);

      // Then: 各戦略の Lot が比率に応じて算出される
      expect(lots.lotOf(StrategyName.SMA_CROSS)?.toNumber()).toBe(4_000);
      expect(lots.lotOf(StrategyName.RSI_REVERSAL)?.toNumber()).toBe(6_000);
    });
  });

  describe('equals()', () => {
    it('同一構成（戦略集合と各 Ratio が一致）で true', () => {
      // Given: 同じ entries から 2 つ生成
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(0.4)],
        [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
      ]);
      const a = LotAllocation.of(entries);
      const b = LotAllocation.of(entries);

      // When / Then
      expect(a.equals(b)).toBe(true);
    });

    it('異なる戦略集合で false', () => {
      // Given: 戦略集合が違う
      const a = LotAllocation.of(
        new Map<StrategyName, Ratio>([
          [StrategyName.SMA_CROSS, Ratio.of(0.4)],
          [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
        ]),
      );
      const b = LotAllocation.of(
        new Map<StrategyName, Ratio>([
          [StrategyName.SMA_CROSS, Ratio.of(0.4)],
          [StrategyName.SMA_DISTANCE, Ratio.of(0.6)],
        ]),
      );

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('一致する戦略集合で値違いで false', () => {
      // Given: 戦略集合は同じだが Ratio 値が違う
      const a = LotAllocation.of(
        new Map<StrategyName, Ratio>([
          [StrategyName.SMA_CROSS, Ratio.of(0.4)],
          [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
        ]),
      );
      const b = LotAllocation.of(
        new Map<StrategyName, Ratio>([
          [StrategyName.SMA_CROSS, Ratio.of(0.5)],
          [StrategyName.RSI_REVERSAL, Ratio.of(0.5)],
        ]),
      );

      // When / Then
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('戦略名=Ratio 値の列挙形式で出力する', () => {
      // Given: 2 戦略
      const alloc = LotAllocation.of(
        new Map<StrategyName, Ratio>([
          [StrategyName.SMA_CROSS, Ratio.of(0.4)],
          [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
        ]),
      );

      // When
      const s = alloc.toString();

      // Then
      expect(s).toContain('SMA_CROSS=');
      expect(s).toContain('RSI_REVERSAL=');
      expect(s.startsWith('LotAllocation(')).toBe(true);
      expect(s.endsWith(')')).toBe(true);
    });

    it('suppressed 形式でも出力できる', () => {
      // Given: 全戦略抑制
      const alloc = LotAllocation.suppressed([
        StrategyName.SMA_CROSS,
        StrategyName.RSI_REVERSAL,
      ]);

      // When
      const s = alloc.toString();

      // Then: 各戦略が含まれる（Ratio.zero の表示）
      expect(s).toContain('SMA_CROSS=');
      expect(s).toContain('RSI_REVERSAL=');
    });
  });

  describe('strategies()', () => {
    it('抑制戦略は含まれず、配分対象戦略のみが返る', () => {
      // Given: SMA_CROSS=0.4, RSI_REVERSAL=0.6, SMA_DISTANCE=0（抑制）
      const entries = new Map<StrategyName, Ratio>([
        [StrategyName.SMA_CROSS, Ratio.of(0.4)],
        [StrategyName.RSI_REVERSAL, Ratio.of(0.6)],
        [StrategyName.SMA_DISTANCE, Ratio.zero()],
      ]);
      const alloc = LotAllocation.of(entries);

      // When
      const strategies = alloc.strategies();

      // Then: 抑制された SMA_DISTANCE は含まれない
      const values = strategies.map((s) => s);
      expect(values).toHaveLength(2);
      expect(values).toContain('SMA_CROSS');
      expect(values).toContain('RSI_REVERSAL');
      expect(values).not.toContain('SMA_DISTANCE');
    });
  });
});
