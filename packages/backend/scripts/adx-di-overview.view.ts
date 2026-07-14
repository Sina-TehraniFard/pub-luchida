/**
 * adx-di-overview.ts の表示ロジック（副作用なし）。
 *
 * 本体スクリプトは import しただけで main() が走るため、ユニットテストの対象になる
 * 純粋な整形処理をこのモジュールに分離している。色の有効/無効は Paint 関数の注入で
 * 切り替える（TTY 判定はスクリプト側の責務）。
 */
import { TrendStrength } from '../src/domain/market/indicator/TrendStrength.js';
import {
  TrendDirection,
  trendDirectionLabel,
} from '../src/domain/market/indicator/TrendDirection.js';

const DISPLAY_FRACTION_DIGITS = 1;

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
} as const;

/** text を ANSI 色コードで装飾する関数。 */
export type Paint = (text: string, ...codes: string[]) => string;

/**
 * Paint を生成する。useColor が false のときは何も装飾しない恒等関数になる。
 *
 * 契約: paint の結果を別の paint に渡すネストは不可。内側の reset が外側の色を
 * 途中で解除してしまう。色を変えたい断片は個別に paint してから連結すること。
 */
export function createPaint(useColor: boolean): Paint {
  return (text, ...codes) => {
    if (!useColor || codes.length === 0) return text;
    return codes.join('') + text + ANSI.reset;
  };
}

/**
 * 1 セル（pair × 時間足）の取得結果。正当な状態は3つだけなので判別共用体で表す。
 * 「結果もエラーもある」「どちらもない」という不正状態を型で排除する。
 */
export type CellOutcome =
  | { kind: 'measured'; strength: TrendStrength }
  | { kind: 'insufficientData' }
  | { kind: 'fetchFailed'; message: string };

/**
 * 表示幅（半角=1、全角=2）で数えた文字列の幅。
 * String.prototype.padEnd は文字数基準のため、全角を含むラベルの列が揃わない。
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // ASCII と半角カナは幅1、それ以外（漢字・かな等）は幅2 とみなす。
    width += code <= 0x7f || (code >= 0xff61 && code <= 0xff9f) ? 1 : 2;
  }
  return width;
}

/** 表示幅基準で右に空白を詰める（全角混じりでも列が揃う padEnd）。 */
export function padEndDisplayWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

function arrow(direction: TrendDirection): string {
  switch (direction) {
    case TrendDirection.UP:
      return '↑';
    case TrendDirection.DOWN:
      return '↓';
    case TrendDirection.NEUTRAL:
      return '→';
  }
}

// 向きの色: 上昇=緑 / 下降=赤 / 中立=グレー。
function directionColor(direction: TrendDirection): string {
  switch (direction) {
    case TrendDirection.UP:
      return ANSI.green;
    case TrendDirection.DOWN:
      return ANSI.red;
    case TrendDirection.NEUTRAL:
      return ANSI.gray;
  }
}

/** 1 セル分の表示文字列を組み立てる。 */
export function formatValue(outcome: CellOutcome, paint: Paint): string {
  switch (outcome.kind) {
    case 'fetchFailed':
      return paint('取得失敗', ANSI.red);
    case 'insufficientData':
      return paint('(データ不足)', ANSI.gray);
    case 'measured': {
      const strength = outcome.strength;
      const adxVal = strength.adx;
      const adx = adxVal.toFixed(DISPLAY_FRACTION_DIGITS).padStart(5);
      const diP = strength.diPlus.toFixed(DISPLAY_FRACTION_DIGITS).padStart(5);
      const diM = strength.diMinus.toFixed(DISPLAY_FRACTION_DIGITS).padStart(5);
      const dir = strength.direction();

      // ADX の強さで濃淡を付ける（弱=薄字 / 非常に強い=太字）。区分は AdxValue が持つ
      // Wilder の慣例（20 未満は弱い / 40 以上は非常に強い）に従う。
      let adxPainted: string;
      if (adxVal.isVeryStrongTrend()) {
        adxPainted = paint(adx, ANSI.bold, ANSI.yellow);
      } else if (adxVal.isWeakTrend()) {
        adxPainted = paint(adx, ANSI.dim);
      } else {
        adxPainted = adx;
      }

      const dirText = paint(`${arrow(dir)}${trendDirectionLabel(dir)}`, directionColor(dir));
      return `ADX=${adxPainted}  +DI=${diP}  -DI=${diM}  ${dirText}`;
    }
  }
}
