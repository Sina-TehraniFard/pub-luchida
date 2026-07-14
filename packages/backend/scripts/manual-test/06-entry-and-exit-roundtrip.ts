/**
 * テスト06: エントリー → 即決済の往復テスト
 * ⚠️ 入金必須。実際に注文+決済が発生する。市場オープン中に実行。
 * BUY 100通貨 → 即 SELL で決済。スプレッド分だけ損失が出る。
 *
 * 実行: node --env-file=.env --import tsx scripts/manual-test/06-entry-and-exit-roundtrip.ts
 */
import { GmoRestClient } from '../../src/adapter/gmo/GmoRestClient.js';
import { GmoBrokerAdapter } from '../../src/adapter/gmo/GmoBrokerAdapter.js';
import { EntryCommand } from '../../src/domain/command/EntryCommand.js';
import { Position } from '../../src/domain/position/Position.js';
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
  reason: EntryReason.of('往復テスト'),
  convictionScore: ConvictionScore.of(0.5),
  strategyName: StrategyName.SMA_CROSS,
  entrySnapshot: EntrySnapshot.of({ convictionScore: '0.5', entryHour: 12, entryDayOfWeek: 3 }),
  requiredMargin: Money.jpy('600'),
});

console.log('=== 往復テスト開始 ===\n');

// エントリー
console.log('1. BUY 100通貨 USD/JPY エントリー...');
const entryResult = await broker.placeEntry(command);
console.log('   ✅ エントリー成功');
console.log(`   positionId: ${entryResult.positionId}`);
console.log(`   entryPrice: ${entryResult.entryPrice}`);

// 即決済
const position = Position.open(command, entryResult);
console.log('\n2. 即決済（SELL）...');
const exitResult = await broker.placeExit(position);
console.log('   ✅ 決済成功');
console.log(`   exitPrice:  ${exitResult.exitPrice}`);
console.log(`   profitLoss: ${exitResult.profitLoss}`);

console.log('\n=== 往復テスト完了 ===');
console.log(`スプレッドコスト: ${exitResult.profitLoss}`);
