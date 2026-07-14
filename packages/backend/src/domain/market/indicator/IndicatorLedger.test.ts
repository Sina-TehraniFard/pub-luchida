import { describe, it, expect, beforeEach } from 'vitest';
import { Price } from '../Price.js';
import { TimeFrame } from '../TimeFrame.js';
import { CandleCloseTime } from '../candle/CandleCloseTime.js';
import { CandleOpenTime } from '../candle/CandleOpenTime.js';
import { ConfirmedCandle } from '../candle/ConfirmedCandle.js';
import { FormingCandle } from '../candle/FormingCandle.js';
import { Tick } from '../tick/Tick.js';
import { TickTimestamp } from '../tick/TickTimestamp.js';
import type { SmaCalculator, SmaCalculatorFactory } from './SmaCalculator.js';
import { IndicatorLedger } from './IndicatorLedger.js';

/**
 * テスト用の素朴な SMA 実装。domain 層内で完結する
 */
class SimpleSmaCalculator implements SmaCalculator {
  private readonly period: number;
  private readonly values: number[] = [];
  private replaced = false;

  constructor(period: number) {
    this.period = period;
  }

  add(value: number): void {
    this.values.push(value);
    this.replaced = false;
  }

  replace(value: number): void {
    if (this.values.length === 0) return;
    this.values[this.values.length - 1] = value;
  }

  isStable(): boolean {
    return this.values.length >= this.period;
  }

  getResult(): number {
    const window = this.values.slice(-this.period);
    return window.reduce((sum, v) => sum + v, 0) / window.length;
  }
}

const factory: SmaCalculatorFactory = {
  create: (period: number) => new SimpleSmaCalculator(period),
};

// ── テストヘルパー ──────────────────────────────────────────

/** close 価格だけ指定して 1分足の ConfirmedCandle を作る */
const confirmedCandle = (close: string, index: number): ConfirmedCandle => {
  const baseMs = new Date('2024-01-15T10:00:00.000Z').getTime();
  const openMs = baseMs + index * 60_000;
  const closeMs = openMs + 60_000;
  const p = Price.of(close);
  return ConfirmedCandle.of({
    open: p,
    high: p,
    low: p,
    close: p,
    openTime: CandleOpenTime.of(new Date(openMs)),
    closeTime: CandleCloseTime.of(new Date(closeMs)),
    timeFrame: TimeFrame.ONE_MINUTE,
  });
};

/** 指定 close 値の FormingCandle を作る */
const formingCandle = (midApprox: string): FormingCandle => {
  const mid = parseFloat(midApprox);
  const ask = Price.of(String(mid + 0.001));
  const bid = Price.of(String(mid - 0.001));
  const ts = TickTimestamp.of(new Date('2024-01-15T11:00:00.000Z'));
  return FormingCandle.open(Tick.of(ask, bid, ts), TimeFrame.ONE_MINUTE);
};

// ── テスト ──────────────────────────────────────────────────
// shortPeriod=3, longPeriod=5 を使う
// warmUp データ: [100, 101, 102, 103, 104]
//
// 短期SMA(3) の推移:
//   3本目(102): (100+101+102)/3 = 101
//   4本目(103): (101+102+103)/3 = 102
//   5本目(104): (102+103+104)/3 = 103
//
// 長期SMA(5) の推移:
//   5本目(104): (100+101+102+103+104)/5 = 102

describe('IndicatorLedger', () => {
  const SHORT = 3;
  const LONG = 5;
  const warmUpCandles = [
    confirmedCandle('100', 0),
    confirmedCandle('101', 1),
    confirmedCandle('102', 2),
    confirmedCandle('103', 3),
    confirmedCandle('104', 4),
  ];

  let ledger: IndicatorLedger;

  beforeEach(() => {
    ledger = new IndicatorLedger(SHORT, LONG, factory);
  });

  describe('warmUp()', () => {
    it('warmUp 後に currentValues() がエラーなく返る', () => {
      // Given / When
      ledger.warmUp(warmUpCandles);

      // Then
      expect(() => ledger.currentValues()).not.toThrow();
    });

    it('warmUp 前に currentValues() を呼ぶとエラーになる', () => {
      // Given: warmUp していない

      // When / Then
      expect(() => ledger.currentValues()).toThrow('SMA がまだ安定していません');
    });
  });

  describe('warmUp 後の confirmed SMA', () => {
    it('短期SMA の current は最後の3本の平均（103）', () => {
      // Given
      ledger.warmUp(warmUpCandles);

      // When
      const values = ledger.currentValues();

      // Then: SMA(3) of [102,103,104] = 103
      expect(values.confirmed.shortSma.toString()).toBe('103');
    });

    it('短期SMA の previous は前回の SMA 値（102）', () => {
      // Given
      ledger.warmUp(warmUpCandles);

      // When
      const values = ledger.currentValues();

      // Then: SMA(3) of [101,102,103] = 102
      expect(values.confirmed.previousShortSma.toString()).toBe('102');
    });

    it('長期SMA の current は最後の5本の平均（102）', () => {
      // Given
      ledger.warmUp(warmUpCandles);

      // When
      const values = ledger.currentValues();

      // Then: SMA(5) of [100,101,102,103,104] = 102
      expect(values.confirmed.longSma.toString()).toBe('102');
    });

    it('短期SMA が上昇中（current=103 > previous=102）', () => {
      // Given
      ledger.warmUp(warmUpCandles);

      // When
      const values = ledger.currentValues();

      // Then: shortSma(103) > previousShortSma(102)
      expect(parseFloat(values.confirmed.shortSma.toString())).toBeGreaterThan(
        parseFloat(values.confirmed.previousShortSma.toString()),
      );
    });
  });

  describe('warmUp 後の forming SMA（仮値なし）', () => {
    it('仮値を入れていない場合、forming.current は confirmed.current と同じ', () => {
      // Given: warmUp のみ。onCandleUpdated 未呼び出し
      ledger.warmUp(warmUpCandles);

      // When
      const values = ledger.currentValues();

      // Then: forming.shortSma === confirmed.shortSma
      expect(values.forming.shortSma.toString()).toBe(
        values.confirmed.shortSma.toString(),
      );
    });

    it('forming.previous は confirmed.current と同じ', () => {
      // Given
      ledger.warmUp(warmUpCandles);

      // When
      const values = ledger.currentValues();

      // Then: forming.previousShortSma === confirmed.shortSma
      expect(values.forming.previousShortSma.toString()).toBe(
        values.confirmed.shortSma.toString(),
      );
    });
  });

  describe('onCandleUpdated()（形成中足の更新）', () => {
    it('形成中足の close で SMA が仮計算される', () => {
      // Given: warmUp 後、形成中足 close = 110
      ledger.warmUp(warmUpCandles);
      const forming = formingCandle('110');

      // When: 形成中足を通知
      ledger.onCandleUpdated(forming);

      // Then: forming.shortSma = SMA(3) of [103, 104, 110] = 105.666...
      const values = ledger.currentValues();
      const formingShort = parseFloat(values.forming.shortSma.toString());
      expect(formingShort).toBeCloseTo(105.6667, 3);
    });

    it('形成中足を2回更新すると最新の close で SMA が計算される', () => {
      // Given: warmUp 後、最初の更新
      ledger.warmUp(warmUpCandles);
      ledger.onCandleUpdated(formingCandle('110'));

      // When: close = 120 で再更新（replace される）
      ledger.onCandleUpdated(formingCandle('120'));

      // Then: forming.shortSma = SMA(3) of [103, 104, 120] = 109
      const values = ledger.currentValues();
      const formingShort = parseFloat(values.forming.shortSma.toString());
      expect(formingShort).toBeCloseTo(109, 3);
    });

    it('forming.previous は confirmed.current のまま変わらない', () => {
      // Given
      ledger.warmUp(warmUpCandles);

      // When
      ledger.onCandleUpdated(formingCandle('110'));

      // Then: forming.previousShortSma = 確定の current = 103
      const values = ledger.currentValues();
      expect(values.forming.previousShortSma.toString()).toBe('103');
    });
  });

  describe('onCandleConfirmed()（足の確定）', () => {
    it('新しい確定足で confirmed SMA が更新される', () => {
      // Given: warmUp 後（shortCurrent=103, shortPrev=102）
      ledger.warmUp(warmUpCandles);

      // When: close = 105 の足が確定
      ledger.onCandleConfirmed(confirmedCandle('105', 5));

      // Then: SMA(3) of [103, 104, 105] = 104
      const values = ledger.currentValues();
      expect(values.confirmed.shortSma.toString()).toBe('104');
    });

    it('確定後の previous は前回の current（103）になる', () => {
      // Given
      ledger.warmUp(warmUpCandles);

      // When
      ledger.onCandleConfirmed(confirmedCandle('105', 5));

      // Then
      const values = ledger.currentValues();
      expect(values.confirmed.previousShortSma.toString()).toBe('103');
    });

    it('確定後の forming の仮値がリセットされる', () => {
      // Given: warmUp + 形成中足を登録
      ledger.warmUp(warmUpCandles);
      ledger.onCandleUpdated(formingCandle('110'));

      // When: 足が確定（仮値がリセットされる）
      ledger.onCandleConfirmed(confirmedCandle('105', 5));

      // Then: forming.shortSma = confirmed.shortSma（仮値なし）
      const values = ledger.currentValues();
      expect(values.forming.shortSma.toString()).toBe(
        values.confirmed.shortSma.toString(),
      );
    });
  });

  describe('確定 → 形成中更新のサイクル', () => {
    it('確定後に新しい形成中足を登録できる', () => {
      // Given: warmUp + 足確定
      ledger.warmUp(warmUpCandles);
      ledger.onCandleConfirmed(confirmedCandle('105', 5));

      // When: 新しい形成中足 close = 106
      ledger.onCandleUpdated(formingCandle('106'));

      // Then: forming の短期SMA = SMA(3) of [104, 105, 106] = 105
      const values = ledger.currentValues();
      const formingShort = parseFloat(values.forming.shortSma.toString());
      expect(formingShort).toBeCloseTo(105, 3);
    });
  });

  describe('長期SMA の追跡', () => {
    it('warmUp + 確定で長期SMA の current が更新される', () => {
      // Given: warmUp で longCurrent = SMA(5) of [100..104] = 102
      ledger.warmUp(warmUpCandles);

      // When: close = 105 が確定 → SMA(5) of [101..105] = 103
      ledger.onCandleConfirmed(confirmedCandle('105', 5));

      // Then
      const values = ledger.currentValues();
      expect(values.confirmed.longSma.toString()).toBe('103');
    });

    it('warmUp + 確定で長期SMA の previous が前回値になる', () => {
      // Given
      ledger.warmUp(warmUpCandles);

      // When
      ledger.onCandleConfirmed(confirmedCandle('105', 5));

      // Then: previous = 前回の SMA(5) = 102
      const values = ledger.currentValues();
      expect(values.confirmed.previousLongSma.toString()).toBe('102');
    });

    it('形成中足の更新で長期 forming SMA が仮計算される', () => {
      // Given: warmUp で longCurrent = SMA(5) of [100..104] = 102
      ledger.warmUp(warmUpCandles);

      // When: forming close = 110
      ledger.onCandleUpdated(formingCandle('110'));

      // Then: forming.longSma = SMA(5) of [101,102,103,104,110] = 104
      const values = ledger.currentValues();
      const formingLong = parseFloat(values.forming.longSma.toString());
      expect(formingLong).toBeCloseTo(104, 3);
    });

    it('長期 forming SMA の previous は confirmed.current（102）', () => {
      // Given
      ledger.warmUp(warmUpCandles);

      // When
      ledger.onCandleUpdated(formingCandle('110'));

      // Then
      const values = ledger.currentValues();
      expect(values.forming.previousLongSma.toString()).toBe('102');
    });
  });

  describe('warmUp 不足のエラー', () => {
    it('longPeriod 未満の足で warmUp した場合、currentValues() でエラーになる', () => {
      // Given: SMA(5) に対して 3 本しか渡さない
      const tooFew = [
        confirmedCandle('100', 0),
        confirmedCandle('101', 1),
        confirmedCandle('102', 2),
      ];

      // When
      ledger.warmUp(tooFew);

      // Then: 長期SMA が安定していないのでエラー
      expect(() => ledger.currentValues()).toThrow('SMA がまだ安定していません');
    });
  });

  describe('requiredBarsForStable()', () => {
    it('長短どちらの SMA も安定するのに必要な本数（長い方の窓長）を返す', () => {
      // SHORT=3, LONG=5 → max=5
      expect(ledger.requiredBarsForStable()).toBe(LONG);
    });
  });

  describe('reconcileWith()（公式値での照合・訂正）', () => {
    it('内部値とズレた公式列で再構築すると corrected=true', () => {
      // Given: warmUp で shortSma=103 になっている
      ledger.warmUp(warmUpCandles);

      // When: 全く違う公式列で再構築（close を +10 した列）
      const official = [
        confirmedCandle('110', 0),
        confirmedCandle('111', 1),
        confirmedCandle('112', 2),
        confirmedCandle('113', 3),
        confirmedCandle('114', 4),
      ];
      const result = ledger.reconcileWith(official);

      // Then: 差分あり、SMA が公式ベースに変わる
      expect(result.corrected).toBe(true);
      expect(result.before).not.toBeNull();
      expect(result.after).not.toBeNull();
      // SMA(3) of [112,113,114] = 113
      expect(ledger.currentValues().confirmed.shortSma.toString()).toBe('113');
    });

    it('同じ列で再構築すると corrected=false', () => {
      // Given
      ledger.warmUp(warmUpCandles);

      // When: warmUp と同じ列で照合
      const result = ledger.reconcileWith(warmUpCandles);

      // Then: 差分なし
      expect(result.corrected).toBe(false);
      // SMA は warmUp と同じ
      expect(ledger.currentValues().confirmed.shortSma.toString()).toBe('103');
    });

    it('未安定状態から安定する公式列で再構築すると corrected=true（before=null）', () => {
      // Given: warmUp 不足で未安定
      ledger.warmUp([confirmedCandle('100', 0), confirmedCandle('101', 1)]);

      // When: 十分な公式列で再構築
      const result = ledger.reconcileWith(warmUpCandles);

      // Then: before は null、after は値あり、corrected=true
      expect(result.before).toBeNull();
      expect(result.after).not.toBeNull();
      expect(result.corrected).toBe(true);
      expect(() => ledger.currentValues()).not.toThrow();
    });

    it('再構築後に previous も公式列ベースで追跡される', () => {
      // Given
      ledger.warmUp(warmUpCandles);

      // When: 単調増加の公式列
      const official = [
        confirmedCandle('200', 0),
        confirmedCandle('201', 1),
        confirmedCandle('202', 2),
        confirmedCandle('203', 3),
        confirmedCandle('204', 4),
      ];
      ledger.reconcileWith(official);

      // Then: short current = SMA(3) of [202,203,204] = 203, previous = SMA(3) of [201,202,203] = 202
      const values = ledger.currentValues();
      expect(values.confirmed.shortSma.toString()).toBe('203');
      expect(values.confirmed.previousShortSma.toString()).toBe('202');
    });
  });

  describe('複数回の確定サイクル', () => {
    it('2回連続で確定すると previous が正しく追跡される', () => {
      // Given: warmUp → 1回目の確定
      ledger.warmUp(warmUpCandles);
      ledger.onCandleConfirmed(confirmedCandle('105', 5));
      // shortCurrent = SMA(3) of [103,104,105] = 104, shortPrev = 103

      // When: 2回目の確定
      ledger.onCandleConfirmed(confirmedCandle('106', 6));
      // shortCurrent = SMA(3) of [104,105,106] = 105, shortPrev = 104

      // Then
      const values = ledger.currentValues();
      expect(values.confirmed.shortSma.toString()).toBe('105');
      expect(values.confirmed.previousShortSma.toString()).toBe('104');
    });
  });
});
