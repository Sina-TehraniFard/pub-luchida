import Big from 'big.js';
import { BigSum } from './BigSum.js';
import { Lot } from './position/Lot.js';

/**
 * 0.0〜1.0 の比率を表す汎用値オブジェクト。
 *
 * - 内部値は SCALE=10 桁で切り捨て（roundDown）保持される。
 * - 入力 0.0〜1.0 範囲外は生成不可。
 * - add は 1.0 超で Error。addUnchecked は 1.0 超を許容する場面で使い、戻り値は BigSum 型。
 * - times は乗算により桁が増えるため都度 SCALE 切り捨て。
 * - LotAllocation の合計検証では |sum - 1.0| <= EPSILON (1e-9) を許容する。
 *
 * 設計書: docs/design/value-objects.md セクション 6.1 / Ratio (L681-)。
 */
export class Ratio {
  private static readonly SCALE = 10;

  /** 1e-9。LotAllocation.of の合計検証で使用 */
  static readonly EPSILON: Big = new Big('0.000000001');

  private constructor(private readonly value: Big) {}

  static of(value: string | number): Ratio {
    const raw = new Big(value);
    if (raw.lt(0) || raw.gt(1)) {
      throw new Error(`Ratio は 0.0〜1.0: ${value}`);
    }
    const v = raw.round(Ratio.SCALE, Big.roundDown);
    return new Ratio(v);
  }

  static zero(): Ratio {
    return new Ratio(new Big(0));
  }

  static one(): Ratio {
    return new Ratio(new Big(1));
  }

  /**
   * 1/n を SCALE 桁切り捨てで丸めた Ratio を返す。
   * 等ウェイト残余寄せの基準比率算出に使う（EqualWeightAllocationPolicy）。
   * SCALE 桁丸めの責務を Ratio 内に閉じ込め、利用側に丸めロジックを露出させない。
   */
  static divideOne(n: number): Ratio {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Ratio.divideOne(n) は正の整数を要求: ${n}`);
    }
    if (n === 1) return Ratio.one();
    const v = new Big(1).div(n).round(Ratio.SCALE, Big.roundDown);
    return new Ratio(v);
  }

  /**
   * 1 - (k × parts) を Ratio として返す。残余寄せ末尾戦略の比率算出に使う。
   * 結果が 0..1 範囲外の場合は Ratio.of の検証で throw する。
   */
  static complementOf(parts: Ratio, k: number): Ratio {
    if (!Number.isInteger(k) || k < 0) {
      throw new Error(`Ratio.complementOf(k) は非負整数を要求: ${k}`);
    }
    const v = new Big(1).minus(parts.value.times(k));
    return Ratio.of(v.toFixed(Ratio.SCALE));
  }

  add(other: Ratio): Ratio {
    const sum = this.value.plus(other.value);
    if (sum.gt(1)) {
      throw new Error(`Ratio の合計は 1.0 を超えられません: ${sum.toFixed(Ratio.SCALE)}`);
    }
    return new Ratio(sum);
  }

  /**
   * 1.0 超を許容する加算。残余寄せの中間合算で使用。
   * Ratio の 0.0〜1.0 不変条件を破らないために、戻り値は Ratio ではなく BigSum 型。
   * BigSum は制約のない比率合計を表す中間型で、最終的に LotAllocation.of の検証で
   * |sum - 1.0| <= EPSILON で許容誤差付き判定する。
   * 通常の足し算は add() を使うこと。
   */
  addUnchecked(other: Ratio): BigSum {
    return BigSum.fromRatio(this).addRatio(other);
  }

  times(other: Ratio): Ratio {
    return new Ratio(this.value.times(other.value).round(Ratio.SCALE, Big.roundDown));
  }

  applyTo(lot: Lot): Lot {
    const scaled = new Big(lot.toNumber()).times(this.value);
    const rounded = scaled.div(100).round(0, Big.roundDown).times(100).toNumber();
    return Lot.of(rounded);
  }

  isZero(): boolean {
    return this.value.eq(0);
  }

  equals(other: Ratio): boolean {
    return this.value.eq(other.value);
  }

  // LotAllocation.of の |sum - 1.0| 判定など、Big 演算が必要な内部実装で使う
  /** @internal */
  toBig(): Big {
    return this.value;
  }

  toString(): string {
    return this.value.toFixed(Ratio.SCALE);
  }
}
