/**
 * テスト04: USD/JPY を BUY 100通貨でエントリーする
 * ⚠️ 入金必須。実際に注文が発生する。市場オープン中に実行。
 * 最小ロット（100通貨）なので証拠金は数百円程度。
 *
 * 実行: node --env-file=.env --import tsx scripts/manual-test/04-entry-buy.ts
 */
import { GmoRestClient } from '../../src/adapter/gmo/GmoRestClient.js';
import { GmoBrokerAdapter } from '../../src/adapter/gmo/GmoBrokerAdapter.js';
import { EntryCommand } from '../../src/domain/command/EntryCommand.js';
import { CurrencyPair } from '../../src/domain/market/CurrencyPair.js';
import { Lot } from '../../src/domain/position/Lot.js';
import { ConvictionScore } from '../../src/domain/market/ConvictionScore.js';
import { EntryReason } from '../../src/domain/command/EntryReason.js';
import { StrategyName } from '../../src/domain/rule/StrategyName.js';
import { EntrySnapshot } from '../../src/domain/market/snapshot/EntrySnapshot.js';
import { Money } from '../../src/domain/Money.js';

const client = new GmoRestClient(
  process.env.GMO_API_KEY!,
  process.env.GMO_API_SECRET!,
);
const broker = new GmoBrokerAdapter(client);

const command = EntryCommand.of({
  pair: CurrencyPair('USD_JPY'),
  buySell: 'BUY',
  lot: Lot.of(100),
  reason: EntryReason.of('手動テスト: エントリー確認'),
  convictionScore: ConvictionScore.of(0.5),
  strategyName: StrategyName.SMA_CROSS,
  entrySnapshot: EntrySnapshot.of({ convictionScore: '0.5', entryHour: 12, entryDayOfWeek: 3 }),
  requiredMargin: Money.jpy('600'),
});

console.log('BUY 100通貨 USD/JPY のエントリー注文を送信中...\n');

try {
  const result = await broker.placeEntry(command);
  console.log('✅ エントリー成功!');
  console.log('  positionId:', result.positionId.toString());
  console.log('  entryPrice:', result.entryPrice.toString());
  console.log('  executedAt:', result.executedAt.toString());
  console.log('\n⚠️ ポジションが残っています。05-exit-position.ts で決済してください。');
  console.log(`  決済コマンド: node --env-file=.env --import tsx scripts/manual-test/05-exit-position.ts ${result.positionId.toString()}`);
} catch (err) {
  console.error('❌ エントリー失敗:', err);
  process.exit(1);
}
