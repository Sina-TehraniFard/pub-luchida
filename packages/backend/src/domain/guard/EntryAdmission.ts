/**
 * 番人が「新規エントリーを許してよいか」に返す答え（値オブジェクト）。
 *
 * boolean を排除し `admission.isBlocked()` を業務語として読めるようにする。
 * 抑止時は理由ラベルを運ぶ。将来 TradingGuard 統合時、複数の停止根拠
 * （認証失敗 / 経済指標 / メンテ / 異常検知）を語り分ける拡張点になる。
 * 出典: #290 Step2。
 */
export class EntryAdmission {
  private constructor(
    private readonly blocked: boolean,
    private readonly reason: string | null,
  ) {}

  /** 許可（理由なし） */
  static permitted(): EntryAdmission {
    return new EntryAdmission(false, null);
  }

  /** 抑止（理由ラベル付き） */
  static blocked(reason: string): EntryAdmission {
    return new EntryAdmission(true, reason);
  }

  isBlocked(): boolean {
    return this.blocked;
  }

  /** 抑止理由のラベル。許可時は空文字 */
  reasonLabel(): string {
    return this.reason ?? '';
  }
}
