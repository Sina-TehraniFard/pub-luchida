/**
 * BT スクリプトが確保した DB リソース（DataProvider / 結果保存用 Pool）を確実に解放する。
 *
 * finally 内で `await a.close(); await b.end();` と逐次に書くと、前者が例外を投げた時点で
 * 後者へ到達せず一方が解放されないまま残る。ここでは各クローズを独立に試行することで
 * 両方の解放を保証する。
 *
 * 解放失敗時は throw せず警告ログに留める。本関数は呼び出し側の finally から呼ばれるため、
 * ここで throw すると try 側で進行中の例外（BT 本体の失敗）が握り潰される。BT スクリプトは
 * ローカルツールであり、解放失敗そのものより「BT が落ちた本来の原因」を残す方が重要。
 */
export async function closeBacktestResources(
  dataProvider: { close(): Promise<void> },
  resultPool: { end(): Promise<void> },
): Promise<void> {
  const errors: unknown[] = [];

  try {
    await dataProvider.close();
  } catch (e) {
    errors.push(e);
  }

  try {
    await resultPool.end();
  } catch (e) {
    errors.push(e);
  }

  if (errors.length > 0) {
    console.error('BT リソースの解放に失敗しました:', ...errors);
  }
}
