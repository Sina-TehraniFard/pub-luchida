/**
 * 表示用タイムゾーンの単一定義（backend パッケージ内の 1 対多の参照元）。
 *
 * backend で「人間向けに時刻を出す瞬間」はすべてここを参照する。保存値
 * （DB の TIMESTAMPTZ）や内部処理は UTC のままで、変換するのは表示の瞬間だけ。
 * 将来 UTC 運用や別地域へ切り替える場合は、この 1 箇所の変更で backend 内の
 * 全参照箇所が追従する。
 *
 * IANA タイムゾーン名で指定する（"+9" のようなオフセット直書きはしない）。
 * 名前で指定すれば OS のタイムゾーン DB が変換を担うため、サーバーの
 * 設置場所（リージョン）に依存せず常に同じ地域時刻で表示される。
 *
 * 適用範囲の線引き（意図的な設計）:
 * - JST 化する: ログの「書き込み時刻」（Logger.timestamp）など、人間がログを読む
 *   ときの基準時刻。
 * - UTC のまま: ドメイン値オブジェクトの `toString()`（Timestamp 等）、ログ data 内の
 *   業務時刻（足の openTime 等）、API 契約（/api/health の timestamp 等）。これらは
 *   機械可読・他システムとの突き合わせ対象であり、表示用 TZ で歪めない。
 * - backtest パッケージは共有カーネル境界により backend の domain しか import できず、
 *   この定数を参照できない。BT の時刻表示は SQL 側（SET TIME ZONE / to_char）で行う。
 */
export const DISPLAY_TIME_ZONE = 'Asia/Tokyo';

/**
 * Date を `DISPLAY_TIME_ZONE` の `YYYY-MM-DD HH:mm:ss.SSS` 形式に整形する。
 * ログの書き込み時刻など、人間が読む箇所で `toISOString()`（UTC・Z 付き）の
 * 代わりに使う。オフセット表記は付けない（タイムゾーンは運用上 1 つに固定のため）。
 */
export function formatInDisplayTimeZone(date: Date): string {
  // sv-SE ロケールは ISO 8601 に近い "YYYY-MM-DD HH:mm:ss" を返すため整形が安定する。
  const base = date.toLocaleString('sv-SE', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  return `${base}.${millis}`;
}
