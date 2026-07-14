/**
 * xorshift128+ アルゴリズムに基づくシード指定可能な擬似乱数生成器。
 *
 * 同一シードからの乱数列は常に同じになるため、BT の再現性が保証される。
 * パラメータスイープ全体で同一シードを共有することで、
 * 「パラメータの良し悪し」ではなく「運の良し悪し」が混入しない公平な比較が実現できる。
 */
export class SeededRandom {
  private s0: bigint;
  private s1: bigint;

  constructor(seed: number) {
    // seed を 64bit に展開して s0, s1 を初期化する
    // 0 シードを避けるため +1 でオフセット
    this.s0 = BigInt(seed + 1) * 6364136223846793005n + 1442695040888963407n;
    this.s1 = BigInt(seed + 1) * 2862933555777941757n + 3037000493n;
    // ゼロ状態を防ぐガード
    if (this.s0 === 0n) this.s0 = 1n;
    if (this.s1 === 0n) this.s1 = 1n;
  }

  /**
   * 0 以上 1 未満の一様乱数を返す。
   */
  next(): number {
    // xorshift128+ の1ステップ
    let x = this.s0;
    const y = this.s1;
    this.s0 = y;
    x ^= x << 23n;
    x ^= x >> 17n;
    x ^= y;
    x ^= y >> 26n;
    this.s1 = x;

    const sum = this.s0 + this.s1;
    // 64bit 符号なし整数に正規化してから [0, 1) へ変換
    const u64 = BigInt.asUintN(64, sum);
    return Number(u64) / 18446744073709551616;
  }

  /**
   * 標準正規分布 N(0,1) に従う乱数を返す（Box-Muller 変換）。
   */
  nextGaussian(): number {
    // u1 が 0 のときの log(0) = -Infinity を防ぐため最小値をクランプ
    const u1 = Math.max(this.next(), Number.EPSILON);
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}
