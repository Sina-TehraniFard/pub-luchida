import { EntryAdmission } from '../guard/EntryAdmission.js';

/**
 * 新規エントリーの可否を番人に問う読み口（Hexagonal Architecture）。
 *
 * 関門（PositionManager）はこの 1 動詞だけを知る。状態を変えない読み取り専用。
 * Exit を問う口は存在しない＝Exit は番人に止められない（構造による安全保証）。
 * 出典: #290 Step2。
 */
export interface EntryAdmissionPort {
  /** いま新規エントリーを許してよいか（読み取りのみ・状態を変えない） */
  admitEntry(): EntryAdmission;
}

/**
 * 常に許可する Null Object（番人を注入しない構成＝BT 等のデフォルト）。
 * NoopLogPort と同じ作法で port の傍らに置く。
 */
export const AlwaysPermitEntryAdmission: EntryAdmissionPort = {
  admitEntry: () => EntryAdmission.permitted(),
};
