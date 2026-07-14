import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../../../src/infrastructure/database/connection.js';
import { PostgresPositionRepository } from '../../../src/infrastructure/database/PostgresPositionRepository.js';
import { Position } from '../../../src/domain/position/Position.js';
import { PositionId } from '../../../src/domain/position/PositionId.js';
import { CurrencyPair } from '../../../src/domain/market/CurrencyPair.js';
import { Lot } from '../../../src/domain/position/Lot.js';
import { Price } from '../../../src/domain/market/Price.js';
import { Timestamp } from '../../../src/domain/market/Timestamp.js';
import { EntryCommand } from '../../../src/domain/command/EntryCommand.js';
import { EntryResult } from '../../../src/domain/market/EntryResult.js';
import { EntryReason } from '../../../src/domain/command/EntryReason.js';
import { ConvictionScore } from '../../../src/domain/market/ConvictionScore.js';
import { ExitCommand, ExitType } from '../../../src/domain/command/ExitCommand.js';
import { ExitResult } from '../../../src/domain/market/ExitResult.js';
import { ExitReason } from '../../../src/domain/command/ExitReason.js';
import { Pips } from '../../../src/domain/market/Pips.js';
import { StrategyName } from '../../../src/domain/rule/StrategyName.js';
import { EntrySnapshot } from '../../../src/domain/market/snapshot/EntrySnapshot.js';
import { Money } from '../../../src/domain/Money.js';

/**
 * 結合テスト: PostgresPositionRepository → PostgreSQL（実DB）
 *
 * 実行条件:
 * - docker compose up でローカル PostgreSQL が起動している
 * - npm run db:migrate 済み
 * - npm run test:integration で実行
 */
describe('PostgresPositionRepository 結合テスト', () => {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  let db: ReturnType<typeof createDatabase>;
  let repo: PostgresPositionRepository;

  beforeAll(() => {
    db = createDatabase(databaseUrl);
    repo = new PostgresPositionRepository(db.db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  beforeEach(async () => {
    // テストごとにテーブルをクリーン（FK があるので snapshots → positions の順）
    await db.db.execute(sql`DELETE FROM position_entry_snapshots`);
    await db.db.execute(sql`DELETE FROM positions`);
  });

  const makeCommand = () =>
    EntryCommand.of({
      pair: CurrencyPair('USD_JPY'),
      buySell: 'BUY',
      lot: Lot.of(100),
      reason: EntryReason.of('テスト'),
      convictionScore: ConvictionScore.of(0.8),
      strategyName: StrategyName.SMA_CROSS,
      entrySnapshot: EntrySnapshot.of({ convictionScore: '0.8', entryHour: 12, entryDayOfWeek: 3 }),
      requiredMargin: Money.jpy('600'),
    });

  let idCounter = 0;
  const nextId = () => {
    idCounter++;
    return PositionId.generate();
  };

  const makeEntryResult = (positionId?: PositionId) =>
    EntryResult.of({
      positionId: positionId ?? nextId(),
      entryPrice: Price.of('150.123'),
      executedAt: Timestamp.of(new Date('2026-03-30T10:00:00Z')),
    });

  it('register → findById で往復できる', async () => {
    // Given: ポジションを作成
    const command = makeCommand();
    const result = makeEntryResult();
    const position = Position.open(command, result);

    // When: register してから findById
    await repo.register(position);
    const found = await repo.findById(position.id);

    // Then: 復元されたポジションが一致
    expect(found.id.toString()).toBe(position.id.toString());
    expect(found.pair).toBe('USD_JPY');
    expect(found.buySell).toBe('BUY');
    expect(found.lot.toString()).toBe('100');
    expect(found.entryPrice.toString()).toBe('150.123');
    expect(found.status).toBe('OPEN');
  });

  it('register → update（決済）→ findById で CLOSED を確認', async () => {
    // Given: エントリー済みポジション
    const command = makeCommand();
    const entryResult = makeEntryResult();
    const position = Position.open(command, entryResult);
    await repo.register(position);

    // When: 決済して update
    const exitCommand = ExitCommand.of({
      positionId: position.id,
      type: ExitType.TAKE_PROFIT,
      reason: ExitReason.of('目標到達'),
    });
    const exitResult = ExitResult.of({
      exitPrice: Price.of('151.000'),
      executedAt: Timestamp.of(new Date('2026-03-30T12:00:00Z')),
      profitLoss: Pips.of('87.7'),
    });
    position.close(exitCommand, exitResult);
    await repo.update(position);

    // Then: CLOSED で復元される
    const found = await repo.findById(position.id);
    expect(found.status).toBe('CLOSED');
    expect(found.exitPrice!.toString()).toBe('151');
  });

  it('openPositions で OPEN のみ取得', async () => {
    // Given: OPEN 1件 + CLOSED 1件
    const command = makeCommand();

    const pos1 = Position.open(command, makeEntryResult());
    await repo.register(pos1);

    const pos2 = Position.open(command, makeEntryResult());
    await repo.register(pos2);
    pos2.close(
      ExitCommand.of({ positionId: pos2.id, type: ExitType.STOP_LOSS, reason: ExitReason.of('損切り') }),
      ExitResult.of({ exitPrice: Price.of('149.000'), executedAt: Timestamp.of(new Date()), profitLoss: Pips.of('-112.3') }),
    );
    await repo.update(pos2);

    // When: openPositions
    const open = await repo.openPositions();

    // Then: OPEN の1件だけ
    expect(open.count()).toBe(1);
  });

  it('存在しない PositionId で findById するとエラー', async () => {
    await expect(
      repo.findById(PositionId.generate()),
    ).rejects.toThrow('ポジションが見つからない');
  });

  describe('findOpenByPairAndStrategy()', () => {
    it('指定 pair × 指定 strategy の OPEN が 1 件あれば Position を返す', async () => {
      // Given
      const command = makeCommand();
      const position = Position.open(command, makeEntryResult());
      await repo.register(position);

      // When
      const found = await repo.findOpenByPairAndStrategy(CurrencyPair('USD_JPY'), StrategyName.SMA_CROSS);

      // Then
      expect(found).not.toBeNull();
      expect(found!.id.equals(position.id)).toBe(true);
    });

    it('該当 pair × strategy が無ければ null', async () => {
      // Given / When
      const found = await repo.findOpenByPairAndStrategy(CurrencyPair('USD_JPY'), StrategyName.SMA_CROSS);

      // Then
      expect(found).toBeNull();
    });

    it('CLOSED のみなら null（OPEN 限定）', async () => {
      // Given: OPEN → CLOSED に遷移
      const command = makeCommand();
      const position = Position.open(command, makeEntryResult());
      await repo.register(position);
      position.close(
        ExitCommand.of({ positionId: position.id, type: ExitType.STOP_LOSS, reason: ExitReason.of('損切り') }),
        ExitResult.of({ exitPrice: Price.of('149.000'), executedAt: Timestamp.of(new Date()), profitLoss: Pips.of('-100') }),
      );
      await repo.update(position);

      // When
      const found = await repo.findOpenByPairAndStrategy(CurrencyPair('USD_JPY'), StrategyName.SMA_CROSS);

      // Then
      expect(found).toBeNull();
    });

    it('異 pair の OPEN は対象外', async () => {
      // Given: USD_JPY だけ OPEN
      await repo.register(Position.open(makeCommand(), makeEntryResult()));

      // When: EUR_JPY で問い合わせ
      const found = await repo.findOpenByPairAndStrategy(CurrencyPair('EUR_JPY'), StrategyName.SMA_CROSS);

      // Then
      expect(found).toBeNull();
    });

    it('同 pair 異 strategy の OPEN は対象外', async () => {
      // Given: SMA_CROSS で OPEN
      await repo.register(Position.open(makeCommand(), makeEntryResult()));

      // When: RSI_REVERSAL で問い合わせ
      const found = await repo.findOpenByPairAndStrategy(CurrencyPair('USD_JPY'), StrategyName.RSI_REVERSAL);

      // Then
      expect(found).toBeNull();
    });
  });
});
