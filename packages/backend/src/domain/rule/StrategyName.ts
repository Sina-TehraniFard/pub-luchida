const VALID_NAMES = ['SMA_CROSS', 'RSI_REVERSAL', 'SMA_DISTANCE', 'WICK_REVERSAL'] as const;

export type StrategyNameValue = (typeof VALID_NAMES)[number];

/**
 * 戦略名を表す識別子的 VO。
 *
 * 演算を持たない識別子のため branded string で表現する（value-objects.md 6.6 / PR #137 の
 * `CurrencyPair` と同じ棲み分け）。branded string なので値そのものが `===` 等価かつ `Map` キーとして
 * 安定に使える（N-C1 で問題となった「`of()` が毎回 new して等価性が壊れる」事象が構造的に起きない）。
 */
export type StrategyName = StrategyNameValue & { readonly __brand: 'StrategyName' };

/**
 * 戦略名を生成する。ホワイトリスト外の値は実行時に拒否する。
 */
export function StrategyName(value: string): StrategyName {
  if (!VALID_NAMES.includes(value as StrategyNameValue)) {
    throw new Error(`無効な戦略名: ${value}（有効値: ${VALID_NAMES.join(', ')}）`);
  }
  return value as StrategyName;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StrategyName {
  /** 戦略名を生成する（`StrategyName(value)` の別名。後方互換 API）。 */
  export function of(value: string): StrategyName {
    return StrategyName(value);
  }

  export const SMA_CROSS: StrategyName = StrategyName('SMA_CROSS');
  export const RSI_REVERSAL: StrategyName = StrategyName('RSI_REVERSAL');
  export const SMA_DISTANCE: StrategyName = StrategyName('SMA_DISTANCE');
  export const WICK_REVERSAL: StrategyName = StrategyName('WICK_REVERSAL');
}

/**
 * 戦略名の等価比較（branded string ゆえ `===` ベース）。
 */
export function strategyNameEquals(a: StrategyName, b: StrategyName): boolean {
  return a === b;
}
