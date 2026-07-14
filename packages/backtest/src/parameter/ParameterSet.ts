import type { CurrencyPair } from '@luchida/backend/domain/market/CurrencyPair.js';
import type { TimeFrame } from '@luchida/backend/domain/market/TimeFrame.js';
import type { StrategyType } from './StrategyType.js';

/**
 * 1回の BT 実行に必要な全パラメータ。
 *
 * `strategy` を discriminator とする discriminated union。
 */
export type ParameterSet =
  | SmaCrossParameters
  | RsiReversalParameters
  | SmaDistanceParameters
  | WickReversalParameters;

/**
 * 全戦略に共通する実行条件。
 */
interface BaseParameters {
  pair: CurrencyPair;
  timeframe: TimeFrame;
  /** 検証期間の開始（inclusive） */
  dateFrom: Date;
  /** 検証期間の終了（exclusive） */
  dateTo: Date;
}

/**
 * BaseParameters の全フィールド名。戦略固有パラメータの抽出（Runner.extractStrategyParams）で
 * 「共通フィールドかどうか」を判定する単一の真実の源。
 *
 * `satisfies` により BaseParameters に共通フィールドを追加・削除したとき、ここを更新しないと
 * 型エラーになる。除外リストの所有権を BaseParameters の隣に置くことで、二重管理による
 * 列挙漏れを構造的に防ぐ。
 *
 * discriminator の `strategy` は BaseParameters のメンバーではないため、ここには含めない
 * （抽出側で別途除外する）。
 */
export const BASE_PARAMETER_KEYS = ['pair', 'timeframe', 'dateFrom', 'dateTo'] as const satisfies ReadonlyArray<keyof BaseParameters>;

// satisfies は「各要素が keyof BaseParameters に属すること（過剰列挙の禁止）」しか保証しない。
// BaseParameters にフィールドを追加して BASE_PARAMETER_KEYS への追記を忘れた場合（列挙漏れ）は
// 検出できないため、欠落キーが never であることを以下で型レベルにアサートする。
// BaseParameters に共通フィールドを足すと MissingBaseParameterKeys が never でなくなりコンパイルエラーになる。
type MissingBaseParameterKeys = Exclude<keyof BaseParameters, (typeof BASE_PARAMETER_KEYS)[number]>;
const _assertAllBaseParameterKeysCovered: MissingBaseParameterKeys extends never ? true : never = true;
void _assertAllBaseParameterKeysCovered;

/**
 * SMA クロス戦略のパラメータ。
 * 短期 SMA が長期 SMA を上抜けたら BUY、下抜けたら SELL。
 */
export interface SmaCrossParameters extends BaseParameters {
  strategy: Extract<StrategyType, 'SMA_CROSS'>;
  /** 短期 SMA の期間（本数） */
  shortPeriod: number;
  /** 長期 SMA の期間（本数） */
  longPeriod: number;
  /** 損切り幅（pips） */
  stopLossPips: number;
  /** 利確幅（pips）。null の場合はクロス決済のみ */
  takeProfitPips: number | null;
  /** トレーリング利確の起動 pips（MFE がこの値に到達したらトレーリング開始）。未指定時は FixedTakeProfitExitRule を使用 */
  trailActivatePips?: number;
  /** トレーリング利確の追従幅（pips）。trailActivatePips と同時に指定する */
  trailWidthPips?: number;
  /** 除外する UTC 時間帯。空配列の場合はフィルタなし */
  excludeHoursUtc: number[];
  /** 保有本数の上限（時間ベース強制決済）。0 で無効 */
  maxHoldBars: number;
  /**
   * 1トレードあたりの許容リスク（資金に対する割合）。例: 0.02 = 2%。
   * リスクベース Lot は backend 側未実装（#306）のため BT では参照されない。
   */
  riskPct: number;
  /**
   * 証拠金維持率ベースの目標維持率（1.25 = 125%）。
   * BT のロット決定は MaintenanceRatioBasedLotPolicy（維持率ベース）に固定（#306）。
   * 未指定時は既定値 1.40（140%）を使う。
   */
  targetMaintenanceRatio?: number;
  /** 証拠金率（1 / レバレッジ）。未指定時は既定値 0.04（= 25倍）を使う。 */
  marginRate?: number;
  /**
   * クロス強度フィルターの最小強度（pips/bar）。
   * (短期 SMA - 長期 SMA) の 1 bar 増分の絶対値がこの値未満ならエントリー見送り。
   * 0 または未指定で無効（フィルターなし）。
   */
  minCrossStrengthPips?: number;
  /**
   * 月中 JST 昼（非 BOJ 日）フィルター。
   * true で、16-21日 × UTC 02-04 時 × 非 BOJ 会合日のエントリーを block。
   * BT 20 年検証で該当 72 件の平均 -7 pips の負け群を排除する目的。
   */
  excludeMidMonthJstLunchNonBoj?: boolean;
  /**
   * 価格-SMA20 の順方向乖離率上限（％、方向別の非対称フィルター）。
   * BUY は price が SMA20 より上に、SELL は price が SMA20 より下に
   * この値超えで乖離していたら「走り切った後の飛びつき」としてエントリー見送り。
   * 逆方向への乖離（BUY で下、SELL で上）は対象外。
   * 0 または未指定で無効。
   */
  maxDirectionalDivergencePct?: number;
  /**
   * 価格帯フィルター。介入リスクの高い価格圏での順張り過剰を抑える。
   * minSellPrice: 価格がこの値未満のとき SELL を block（例: 85 = USD/JPY 85 円未満で SELL 禁止）
   * maxBuyPrice:  価格がこの値超のとき BUY を block
   * どちらか片方だけ指定可能。未指定で無効。
   *
   * SELL 側は採用根拠あり（2009-2012 介入警戒圏での順張り SELL が構造的に負け）。
   * BUY 側は円安トレンド継続性が強く、採用根拠なし（sweep で全区間劣化確認済み）。
   */
  priceBandFilter?: { minSellPrice?: number; maxBuyPrice?: number };
}

/**
 * RSI 反転戦略のパラメータ。
 * RSI が oversold 水準から反発したら BUY、overbought から反落したら SELL。
 */
export interface RsiReversalParameters extends BaseParameters {
  strategy: Extract<StrategyType, 'RSI_REVERSAL'>;
  /** RSI の計算期間 */
  rsiPeriod: number;
  /** 売られすぎ判定の閾値 */
  oversoldThreshold: number;
  /** 買われすぎ判定の閾値 */
  overboughtThreshold: number;
}

/**
 * SMA 乖離戦略のパラメータ。
 * 価格が SMA から一定以上乖離したら逆張り。
 */
export interface SmaDistanceParameters extends BaseParameters {
  strategy: Extract<StrategyType, 'SMA_DISTANCE'>;
  /** 基準となる SMA の期間 */
  smaPeriod: number;
  /** エントリー判定に使う乖離幅（pips） */
  distancePips: number;
}

/**
 * ヒゲ反転戦略のパラメータ。
 * 長いヒゲが反転のサインと判断してエントリー。
 */
export interface WickReversalParameters extends BaseParameters {
  strategy: Extract<StrategyType, 'WICK_REVERSAL'>;
  /** 反転判定に必要なヒゲの最小比率（実体に対するヒゲの倍率） */
  minWickBodyRatio: number;
  /** 実体の最大サイズ（pips）。これより大きい実体は対象外 */
  maxBodyPips: number;
}
