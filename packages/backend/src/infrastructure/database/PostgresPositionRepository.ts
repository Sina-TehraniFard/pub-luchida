import { and, eq } from 'drizzle-orm';
import type { PositionRepository } from '../../port/PositionRepository.js';
import { Position } from '../../domain/position/Position.js';
import { PositionId } from '../../domain/position/PositionId.js';
import { OpenPositions } from '../../domain/position/OpenPositions.js';
import { CurrencyPair } from '../../domain/market/CurrencyPair.js';
import { Lot } from '../../domain/position/Lot.js';
import { Price } from '../../domain/market/Price.js';
import { Timestamp } from '../../domain/market/Timestamp.js';
import { Pips } from '../../domain/market/Pips.js';
import { StrategyName } from '../../domain/rule/StrategyName.js';
import { ExitType } from '../../domain/command/ExitCommand.js';
import { ExitReason } from '../../domain/command/ExitReason.js';
import type { EntrySnapshot } from '../../domain/market/snapshot/EntrySnapshot.js';
import { positions } from './schema/positions.js';
import { positionEntrySnapshots } from './schema/positionEntrySnapshots.js';
import type { Database } from './connection.js';
import { Logger } from '../logging/Logger.js';

/**
 * PositionRepository の実装。
 * Drizzle ORM を使って PostgreSQL にポジションを永続化する。
 * ドメインの Position エンティティと DB の行を相互変換する翻訳者。
 */
export class PostgresPositionRepository implements PositionRepository {
  private readonly logger = new Logger('PostgresPositionRepository');

  constructor(private readonly db: Database) {}

  async register(position: Position, entrySnapshot?: EntrySnapshot): Promise<void> {
    await this.db.insert(positions).values({
      id: position.id.toString(),
      currencyPair: position.pair,
      buySell: position.buySell,
      lot: position.lot.toString(),
      entryPrice: position.entryPrice.toString(),
      status: 'OPEN',
      // 永続化キーは branded string の値そのものを使う（表示用 toString と区別 / CR6）
      strategyName: position.strategyName,
      openedAt: position.openedAt.toDate(),
    });

    await this.db.insert(positionEntrySnapshots).values({
      positionId: position.id.toString(),
      convictionScore: entrySnapshot?.convictionScore ?? null,
      smaSpreadAtrRatio: entrySnapshot?.smaSpreadAtrRatio ?? null,
      adx: entrySnapshot?.adx ?? null,
      atrPips: entrySnapshot?.atrPips ?? null,
      rsi: entrySnapshot?.rsi ?? null,
      spreadPips: entrySnapshot?.spreadPips ?? null,
      trendAlignment: entrySnapshot?.trendAlignment ?? null,
      entryHour: entrySnapshot?.entryHour ?? null,
      entryDayOfWeek: entrySnapshot?.entryDayOfWeek ?? null,
    });

    this.logger.info('ポジション登録', { id: position.id.toString() });
  }

  async update(position: Position): Promise<void> {
    await this.db
      .update(positions)
      .set({
        status: position.status,
        exitPrice: position.exitPrice?.toString() ?? null,
        profitLoss: position.profitLoss?.toString() ?? null,
        closedAt: position.closedAt?.toDate() ?? null,
        exitType: position.exitType ?? null,
        exitReason: position.exitReason?.toString() ?? null,
        mfePips: position.mfePips?.toString() ?? null,
        maePips: position.maePips?.toString() ?? null,
      })
      .where(eq(positions.id, position.id.toString()));

    this.logger.info('ポジション更新', {
      id: position.id.toString(),
      status: position.status,
    });
  }

  async markClosed(id: PositionId): Promise<void> {
    // status = 'OPEN' 条件は不変条件。sync の DB 読み取り後に通常の決済フロー
    // （update(position)）が完走していた場合、正確な約定情報を上書きしない。
    const result = await this.db
      .update(positions)
      .set({ status: 'CLOSED', closedAt: new Date() })
      .where(and(eq(positions.id, id.toString()), eq(positions.status, 'OPEN')));

    if (result.rowCount === 0) {
      this.logger.info('既に CLOSED 済みのため同期更新をスキップ', { id: id.toString() });
      return;
    }
    this.logger.info('ポジションを CLOSED に同期更新', { id: id.toString() });
  }

  async findById(id: PositionId): Promise<Position> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(eq(positions.id, id.toString()));

    if (rows.length === 0) {
      throw new Error(`ポジションが見つからない: ${id.toString()}`);
    }

    return this.toPosition(rows[0]);
  }

  async openPositions(): Promise<OpenPositions> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(eq(positions.status, 'OPEN'));

    const positionList = rows.map((row) => this.toPosition(row));
    return OpenPositions.of(positionList);
  }

  async findOpenByPairAndStrategy(
    pair: CurrencyPair,
    strategy: StrategyName,
  ): Promise<Position | null> {
    // adapter 層の翻訳責務（VO → SQL primitive）: CurrencyPair は branded string、StrategyName は
    // .value で永続化用の値文字列を取り出す。これは singleton 化（issue #130）等とは独立した恒久責務で、
    // Drizzle の eq() が SQL primitive を要求する以上、VO そのものを WHERE 句に渡せない。
    // 注: 表示用 toString ではなく永続化用 value を使う（表示用 toString の意味を将来変えても
    // 検索条件は壊れない / CodeRabbit 指摘 CR6）
    const rows = await this.db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.currencyPair, pair),
          eq(positions.strategyName, strategy),
          eq(positions.status, 'OPEN'),
        ),
      )
      // 部分ユニーク制約導入前の defensive。limit(2) で取得して重複を検知可能にする。
      .limit(2);

    if (rows.length === 0) return null;
    if (rows.length > 1) {
      // 不変条件違反（同条件 2 件以上 OPEN）は本来 DB 部分ユニーク制約で弾くべき。
      // 制約導入前の defensive として明示的に throw し、握りつぶさず観測可能にする（CR7）。
      this.logger.error('OPEN ポジション重複を検知', {
        pair: String(pair),
        strategy: strategy,
        count: rows.length,
      });
      throw new Error(
        `不変条件違反: 同 pair × 同戦略の OPEN position が複数件存在します (pair=${String(pair)}, strategy=${strategy})`,
      );
    }
    return this.toPosition(rows[0]);
  }

  /**
   * DB の行 → Position エンティティに変換する。
   */
  private toPosition(row: typeof positions.$inferSelect): Position {
    return Position.restore({
      id: PositionId.from(row.id),
      pair: CurrencyPair(row.currencyPair),
      buySell: row.buySell as 'BUY' | 'SELL',
      lot: Lot.of(Number(row.lot)),
      entryPrice: Price.of(row.entryPrice),
      openedAt: Timestamp.of(row.openedAt),
      status: row.status as 'OPEN' | 'CLOSED',
      exitPrice: row.exitPrice ? Price.of(row.exitPrice) : undefined,
      closedAt: row.closedAt ? Timestamp.of(row.closedAt) : undefined,
      profitLoss: row.profitLoss ? Pips.of(row.profitLoss) : undefined,
      exitType: row.exitType as ExitType | undefined,
      exitReason: row.exitReason ? ExitReason.of(row.exitReason) : undefined,
      mfePips: row.mfePips ? Pips.of(row.mfePips) : undefined,
      maePips: row.maePips ? Pips.of(row.maePips) : undefined,
      strategyName: StrategyName.of(row.strategyName),
    });
  }
}
