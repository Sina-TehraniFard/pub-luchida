import { describe, it, expect } from 'vitest';
import { SmaValue } from './SmaValue.js';
import { SmaSnapshot } from './SmaSnapshot.js';
import { IndicatorValues } from './IndicatorValues.js';

// ── テストヘルパー ──────────────────────────────────────────

/** 短期・長期の現在値と前回値を指定して SmaSnapshot を作る */
const snapshot = (
  shortSma: string,
  longSma: string,
  previousShortSma: string,
  previousLongSma: string,
): SmaSnapshot =>
  SmaSnapshot.of({
    shortSma: SmaValue.of(shortSma),
    longSma: SmaValue.of(longSma),
    previousShortSma: SmaValue.of(previousShortSma),
    previousLongSma: SmaValue.of(previousLongSma),
  });

// ── テスト ──────────────────────────────────────────────────
describe('IndicatorValues', () => {
  describe('of()（生成）', () => {
    it('confirmed と forming を渡すと IndicatorValues が生成され、confirmed.shortSma が取り出せる', () => {
      // Given: 確定足・形成中足それぞれの SmaSnapshot
      const confirmed = snapshot('151.000', '150.500', '150.000', '149.500');
      const forming = snapshot('152.000', '151.000', '151.000', '150.000');

      // When: IndicatorValues.of() で生成する
      const values = IndicatorValues.of(confirmed, forming);

      // Then: confirmed.shortSma が渡した値と等しい
      expect(values.confirmed.shortSma.equals(SmaValue.of('151.000'))).toBe(true);
    });

    it('confirmed と forming を渡すと IndicatorValues が生成され、confirmed.longSma が取り出せる', () => {
      // Given
      const confirmed = snapshot('151.000', '150.500', '150.000', '149.500');
      const forming = snapshot('152.000', '151.000', '151.000', '150.000');

      // When
      const values = IndicatorValues.of(confirmed, forming);

      // Then: confirmed.longSma が渡した値と等しい
      expect(values.confirmed.longSma.equals(SmaValue.of('150.500'))).toBe(true);
    });

    it('forming.shortSma と forming.longSma が取り出せる', () => {
      // Given
      const confirmed = snapshot('151.000', '150.500', '150.000', '149.500');
      const forming = snapshot('152.000', '151.000', '151.000', '150.000');

      // When
      const values = IndicatorValues.of(confirmed, forming);

      // Then
      expect(values.forming.shortSma.equals(SmaValue.of('152.000'))).toBe(true);
      expect(values.forming.longSma.equals(SmaValue.of('151.000'))).toBe(true);
    });
  });

  describe('confirmed の取得', () => {
    it('of() で渡した confirmed が値として等しい SmaSnapshot として取り出せる', () => {
      // Given
      const confirmed = snapshot('151.000', '150.500', '150.000', '149.500');
      const forming = snapshot('152.000', '151.000', '151.000', '150.000');

      // When
      const values = IndicatorValues.of(confirmed, forming);

      // Then
      expect(values.confirmed.equals(confirmed)).toBe(true);
    });
  });

  describe('値の独立性', () => {
    it('confirmed と forming は独立した値を保持できる', () => {
      // Given: 意図的に異なる SMA 値を持つ 2 つの SmaSnapshot
      const confirmed = snapshot('149.000', '148.000', '150.000', '149.000');
      const forming = snapshot('151.000', '150.000', '150.000', '149.000');

      // When
      const values = IndicatorValues.of(confirmed, forming);

      // Then: confirmed と forming の shortSma が異なる
      expect(values.confirmed.shortSma.equals(values.forming.shortSma)).toBe(false);
    });

    it('confirmed と forming は互いに独立した SmaSnapshot として保持される', () => {
      // Given
      const confirmed = snapshot('149.000', '148.000', '150.000', '149.000');
      const forming = snapshot('151.000', '150.000', '150.000', '149.000');

      // When
      const values = IndicatorValues.of(confirmed, forming);

      // Then
      expect(values.confirmed.equals(values.forming)).toBe(false);
    });
  });

  describe('equals()', () => {
    it('confirmed と forming が等しいとき true を返す', () => {
      // Given: 同じ値で生成した 2 つの IndicatorValues
      const a = IndicatorValues.of(
        snapshot('151.000', '150.500', '150.000', '149.500'),
        snapshot('152.000', '151.000', '151.000', '150.000'),
      );
      const b = IndicatorValues.of(
        snapshot('151.000', '150.500', '150.000', '149.500'),
        snapshot('152.000', '151.000', '151.000', '150.000'),
      );

      // When / Then
      expect(a.equals(b)).toBe(true);
    });

    it('confirmed.shortSma が異なるとき false を返す', () => {
      // Given
      const a = IndicatorValues.of(
        snapshot('151.000', '150.500', '150.000', '149.500'),
        snapshot('152.000', '151.000', '151.000', '150.000'),
      );
      const b = IndicatorValues.of(
        snapshot('153.000', '150.500', '150.000', '149.500'),
        snapshot('152.000', '151.000', '151.000', '150.000'),
      );

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('confirmed.longSma が異なるとき false を返す', () => {
      // Given
      const a = IndicatorValues.of(
        snapshot('151.000', '150.500', '150.000', '149.500'),
        snapshot('152.000', '151.000', '151.000', '150.000'),
      );
      const b = IndicatorValues.of(
        snapshot('151.000', '999.000', '150.000', '149.500'),
        snapshot('152.000', '151.000', '151.000', '150.000'),
      );

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('forming.shortSma が異なるとき false を返す', () => {
      // Given
      const a = IndicatorValues.of(
        snapshot('151.000', '150.500', '150.000', '149.500'),
        snapshot('152.000', '151.000', '151.000', '150.000'),
      );
      const b = IndicatorValues.of(
        snapshot('151.000', '150.500', '150.000', '149.500'),
        snapshot('999.000', '151.000', '151.000', '150.000'),
      );

      // When / Then
      expect(a.equals(b)).toBe(false);
    });

    it('forming.longSma が異なるとき false を返す', () => {
      // Given
      const a = IndicatorValues.of(
        snapshot('151.000', '150.500', '150.000', '149.500'),
        snapshot('152.000', '151.000', '151.000', '150.000'),
      );
      const b = IndicatorValues.of(
        snapshot('151.000', '150.500', '150.000', '149.500'),
        snapshot('152.000', '999.000', '151.000', '150.000'),
      );

      // When / Then
      expect(a.equals(b)).toBe(false);
    });
  });
});
