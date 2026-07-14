import type { BuySell } from '@luchida/backend/domain/market/BuySell.js';
import type { ExitType } from '@luchida/backend/domain/command/ExitCommand.js';

/**
 * 1トレードの明細。
 *
 * 永続化層のスキーマ（bt_trades）と 1:1 対応させる。
 */
export interface TradeRecord {
  /** トレード ID */
  readonly id: string;
  /** 所属する BT 実行の ID */
  readonly runId: string;
  /** run 内の連番（equity curve 再構築用） */
  readonly tradeSeq: number;

  /** 売買方向 */
  readonly side: BuySell;
  /** エントリー時刻（UTC） */
  readonly entryTime: Date;
  /** 決済時刻（UTC） */
  readonly exitTime: Date;
  /** エントリー約定価格 */
  readonly entryPrice: number;
  /** 決済約定価格 */
  readonly exitPrice: number;
  /** ロット数 */
  readonly lot: number;

  /** 損益（pips 建て） */
  readonly pnl: number;
  /** 損益（pips 建て） */
  readonly pnlPips: number;
  /** 損益（円建て） */
  readonly pnlAmount: number;
  /** エントリー時の資産額（円） */
  readonly capitalAtEntry: number;

  /** MFE（pips 建て） */
  readonly mfe: number;
  /** MFE（pips 建て） */
  readonly mfePips: number;
  /** MFE 到達時刻（UTC） */
  readonly mfeTime: Date;
  /** MAE（pips 建て） */
  readonly mae: number;
  /** MAE（pips 建て） */
  readonly maePips: number;
  /** MAE 到達時刻（UTC） */
  readonly maeTime: Date;

  /** エントリー時の ATR（pips）。ATR 未実装時は null */
  readonly atrAtEntry: number | null;

  /** 保有期間（ミリ秒） */
  readonly holdingPeriodMs: number;
  /** 決済理由の種類 */
  readonly exitType: ExitType;

  /** エントリー時刻の時間帯（UTC 0-23） */
  readonly entryHourUtc: number;
  /** エントリー時刻の曜日（0=Sunday, 6=Saturday） */
  readonly entryDayOfWeek: number;

  /** スリッページ（pips） */
  readonly slippagePips: number;
  /** 決済後の資産額（円） */
  readonly equityAfter: number;
}
