import { describe, it, expect } from 'vitest';
import { GmoRestClient } from '../../../src/adapter/gmo/GmoRestClient.js';
import { GmoBrokerAdapter } from '../../../src/adapter/gmo/GmoBrokerAdapter.js';
import { EntryCommand } from '../../../src/domain/command/EntryCommand.js';
import { CurrencyPair } from '../../../src/domain/market/CurrencyPair.js';
import { Lot } from '../../../src/domain/position/Lot.js';
import { ConvictionScore } from '../../../src/domain/market/ConvictionScore.js';
import { EntryReason } from '../../../src/domain/command/EntryReason.js';
import { StrategyName } from '../../../src/domain/rule/StrategyName.js';
import { EntrySnapshot } from '../../../src/domain/market/snapshot/EntrySnapshot.js';
import { Money } from '../../../src/domain/Money.js';

/**
 * 結合テスト: GmoBrokerAdapter → GMO FX Private REST API（実接続）
 *
 * !! 注意 !!
 * このテストは実際に注文を発生させる。
 * 最小ロット（100通貨）で実行する。
 * デモ環境では動作確認済みでも、本番で実行する場合は十分注意すること。
 *
 * 実行条件:
 * - .env に GMO_API_KEY, GMO_API_SECRET を設定済み
 * - 市場オープン中
 * - npm run test:integration で実行
 */
describe('GmoBrokerAdapter 結合テスト', () => {
  const apiKey = process.env.GMO_API_KEY ?? '';
  const apiSecret = process.env.GMO_API_SECRET ?? '';

  it.skip('エントリー → 決済の往復テスト（手動実行用）', async () => {
    if (!apiKey || !apiSecret) {
      console.log('API キーが未設定のためスキップ');
      return;
    }

    const client = new GmoRestClient(apiKey, apiSecret);
    const broker = new GmoBrokerAdapter(client);

    // エントリー
    const command = EntryCommand.of({
      pair: CurrencyPair('USD_JPY'),
      buySell: 'BUY',
      lot: Lot.of(100),
      reason: EntryReason.of('結合テスト'),
      convictionScore: ConvictionScore.of(0.5),
      strategyName: StrategyName.SMA_CROSS,
      entrySnapshot: EntrySnapshot.of({ convictionScore: '0.5', entryHour: 12, entryDayOfWeek: 3 }),
      requiredMargin: Money.jpy('600'),
    });

    const entryResult = await broker.placeEntry(command);
    expect(entryResult.entryPrice).toBeDefined();
    expect(entryResult.positionId).toBeDefined();

    console.log('エントリー約定:', {
      positionId: entryResult.positionId.toString(),
      price: entryResult.entryPrice.toString(),
    });

    // 即座に決済
    const { Position } = await import('../../../src/domain/position/Position.js');
    const position = Position.open(command, entryResult);
    const exitResult = await broker.placeExit(position);

    expect(exitResult.exitPrice).toBeDefined();
    console.log('決済約定:', {
      price: exitResult.exitPrice.toString(),
      profitLoss: exitResult.profitLoss.toString(),
    });
  });
});
