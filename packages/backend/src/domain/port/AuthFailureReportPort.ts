import { AuthAttemptOutcome } from '../guard/AuthAttemptOutcome.js';

/**
 * 認証を伴う試行の結果を番人に報告する書き口（Hexagonal Architecture）。
 *
 * 報告者（定期 sync）はこの 2 動詞だけを知る。番人の状態遷移や可否判定は見せない
 * （関心の分離）。将来 TradingGuard に差し替わっても報告者のコードは触らない。
 * 出典: #290 Step2。
 */
export interface AuthFailureReportPort {
  /** 認証試行の結果を報告する（こと） */
  report(outcome: AuthAttemptOutcome): void;
}

/** 何も記録しない Null Object（番人を注入しない構成＝BT 等のデフォルト） */
export const NoopAuthFailureReport: AuthFailureReportPort = {
  report: () => {},
};
