/**
 * テスト05: 指定した positionId のポジションを決済する
 * ⚠️ 実際に決済注文が発生する。市場オープン中に実行。
 *
 * 実行: node --env-file=.env --import tsx scripts/manual-test/05-exit-position.ts <positionId>
 *
 * positionId は 04-entry-buy.ts の出力に表示される。
 */
import { GmoRestClient } from '../../src/adapter/gmo/GmoRestClient.js';
import { GmoBrokerAdapter } from '../../src/adapter/gmo/GmoBrokerAdapter.js';
import { EntryCommand } from '../../src/domain/command/EntryCommand.js';
import { EntryResult } from '../../src/domain/market/EntryResult.js';
import { Position } from '../../src/domain/position/Position.js';
import { PositionId } from '../../src/domain/position/PositionId.js';
import { CurrencyPair } from '../../src/domain/market/CurrencyPair.js';
import { Lot } from '../../src/domain/position/Lot.js';
import { Price } from '../../src/domain/market/Price.js';
import { Timestamp } from '../../src/domain/market/Timestamp.js';
import { ConvictionScore } from '../../src/domain/market/ConvictionScore.js';
import { EntryReason } from '../../src/domain/command/EntryReason.js';
import { StrategyName } from '../../src/domain/rule/StrategyName.js';
import { EntrySnapshot } from '../../src/domain/market/snapshot/EntrySnapshot.js';
import { Money } from '../../src/domain/Money.js';

const positionIdArg = process.argv[2];
if (!positionIdArg) {
  console.error('使い方: node --env-file=.env --import tsx scripts/manual-test/05-exit-position.ts <positionId>');
  console.error('  positionId は 04-entry-buy.ts の出力で確認してください。');
  process.exit(1);
}

const client = new GmoRestClient(
  process.env.GMO_API_KEY!,
  process.env.GMO_API_SECRET!,
);
const broker = new GmoBrokerAdapter(client);

// Position を復元（決済に必要な最低限の情報）
const command = EntryCommand.of({
  pair: CurrencyPair('USD_JPY'),
  buySell: 'BUY',
  lot: Lot.of(100),
  reason: EntryReason.of('手動テスト'),
  convictionScore: ConvictionScore.of(0.5),
  strategyName: StrategyName.SMA_CROSS,
  entrySnapshot: EntrySnapshot.of({ convictionScore: '0.5', entryHour: 12, entryDayOfWeek: 3 }),
  requiredMargin: Money.jpy('600'),
});
const entryResult = EntryResult.of({
  positionId: PositionId.from(positionIdArg),
  entryPrice: Price.of('1'),  // 決済には使わないがfactory に必要
  executedAt: Timestamp.now(),
});
const position = Position.open(command, entryResult);

console.log(`positionId=${positionIdArg} の決済注文を送信中...\n`);

try {
  const result = await broker.placeExit(position);
  console.log('✅ 決済成功!');
  console.log('  exitPrice:', result.exitPrice.toString());
  console.log('  profitLoss:', result.profitLoss.toString());
  console.log('  executedAt:', result.executedAt.toString());
} catch (err) {
  console.error('❌ 決済失敗:', err);
  process.exit(1);
}
