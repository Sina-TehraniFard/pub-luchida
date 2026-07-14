/**
 * +DI / −DI の優劣から導くトレンド方向。
 *
 * ADX は強さだけを表し方向を持たないため、方向はここで別途表現する。
 * 中立（+DI と −DI が等しい）は実運用では稀だが、判定の取りこぼしを防ぐため明示する。
 */
export const TrendDirection = {
  UP: 'UP',
  DOWN: 'DOWN',
  NEUTRAL: 'NEUTRAL',
} as const;

export type TrendDirection = (typeof TrendDirection)[keyof typeof TrendDirection];

export function trendDirectionLabel(direction: TrendDirection): string {
  switch (direction) {
    case TrendDirection.UP:
      return '上昇';
    case TrendDirection.DOWN:
      return '下降';
    case TrendDirection.NEUTRAL:
      return '中立';
  }
}
