/**
 * 「今は何もしない」という判定結果。
 * EntryRule / ExitRule が「エントリー/決済の条件を満たさない」と判断したときに返す。
 * null / undefined の代わりとして使うヌルオブジェクトパターン。
 *
 * Rule の戻り値型:
 * - EntryRule: EntryCommand | DoNothing
 * - ExitRule:  ExitCommand  | DoNothing
 */
export class DoNothing {
  private constructor() {}

  static readonly instance: DoNothing = new DoNothing();

  toString(): string {
    return 'DoNothing';
  }
}
