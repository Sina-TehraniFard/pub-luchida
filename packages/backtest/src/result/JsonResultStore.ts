import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResultStore } from './ResultStore.js';
import type { BacktestResult } from './BacktestResult.js';

/**
 * BT 結果を JSON ファイルに書き出す ResultStore 実装。
 *
 * 1 実行 = 1 ファイル。trades 配列も含めて1ファイルに格納する。
 * 同じ id への save は上書きになる。
 *
 * JSON は compact 形式で出力する（trades が数千件の場合にファイルサイズが膨れるため）。
 * 読みやすさが必要な場合は jq 等で整形すること。
 *
 * Date フィールドは ISO 8601 文字列として直列化される。
 * JSON.parse で復元した場合は string のまま。Date に戻すには reviver が必要。
 *
 * DB 側（bt_runs）の standard_metrics_computed に相当する判別子は
 * JSON には存在しない。hasDownsideRisk 追加（#336）以前の旧ファイルは
 * キー自体が欠落しており（読み出すと undefined）、それが事実上の
 * 未計算判別になる。
 */
export class JsonResultStore implements ResultStore {
  private dirCreated = false;

  constructor(private readonly outputDir: string) {}

  async save(result: BacktestResult): Promise<void> {
    if (!this.dirCreated) {
      await mkdir(this.outputDir, { recursive: true });
      this.dirCreated = true;
    }
    const fileName = `${result.id}.json`;
    const filePath = join(this.outputDir, fileName);
    const json = JSON.stringify(result);
    await writeFile(filePath, json, 'utf-8');
  }
}
