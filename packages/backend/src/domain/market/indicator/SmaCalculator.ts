/**
 * SMA（単純移動平均）計算の Port。
 * ドメイン層は SMA の計算方法を知らない。
 * 具体的な実装（trading-signals 等）は Adapter 層に置く。
 */
export interface SmaCalculator {
  /** 値を追加して SMA を更新する */
  add(value: number): void;
  /** 最後に追加した値を差し替える（形成中足の close 更新に使う） */
  replace(value: number): void;
  /** SMA が安定しているか（period 分のデータが揃っているか） */
  isStable(): boolean;
  /** 現在の SMA 値を返す。安定していない場合はエラー */
  getResult(): number;
}

/** SmaCalculator のファクトリ。period を指定して生成する */
export interface SmaCalculatorFactory {
  create(period: number): SmaCalculator;
}
