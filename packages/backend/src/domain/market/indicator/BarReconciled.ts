import { TimeFrame } from '../TimeFrame.js';
import { Timestamp } from '../Timestamp.js';
import { SmaSnapshot } from './SmaSnapshot.js';

/**
 * 「確定足が公式値と照合され、是正された」という出来事（こと）。
 *
 * 自前で組んだ確定足・SMA が GMO 公式 klines とズレていたため、公式値を正として
 * 是正した事実を表す。**是正が起きたときだけ生成される**（差分が無ければ生成しない）。
 * INFO ログの発火源であり、読み手は一次=運用者の異常検知。
 *
 * before: 是正前の確定 SMA。SMA がまだ安定していなかった場合のみ null
 *         （= 未安定状態から初めて安定した、という是正）。
 * after:  是正後の確定 SMA。是正が成立した以上、安定しているので常に存在する。
 */
export class BarReconciled {
  constructor(
    readonly timeFrame: TimeFrame,
    readonly reconciledAt: Timestamp,
    readonly before: SmaSnapshot | null,
    readonly after: SmaSnapshot,
  ) {}
}
