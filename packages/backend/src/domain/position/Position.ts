import { PositionId } from './PositionId.js';
import { Lot } from './Lot.js';
import { CurrencyPair } from '../market/CurrencyPair.js';
import { BuySell } from '../market/BuySell.js';
import { Price } from '../market/Price.js';
import { Timestamp } from '../market/Timestamp.js';
import { EntryCommand } from '../command/EntryCommand.js';
import { EntryResult } from '../market/EntryResult.js';
import { ExitResult } from '../market/ExitResult.js';
import { ExitCommand, ExitType } from '../command/ExitCommand.js';
import { ExitReason } from '../command/ExitReason.js';
import { Pips } from '../market/Pips.js';
import { StrategyName } from '../rule/StrategyName.js';
import { pipUnit } from '../market/CurrencyPair.js';

/**
 * 保有中のポジション
 * - エントリー約定時に生成され、決済されるまで保持される
 * - close() で OPEN → CLOSED に遷移し、決済情報を記録する
 */
export class Position {
  private _status: 'OPEN' | 'CLOSED';
  private _exitPrice: Price | null;
  private _closedAt: Timestamp | null;
  private _exitType: ExitType | null;
  private _exitReason: ExitReason | null;
  private _profitLoss: Pips | null;
  private _mfePips: Pips | null;
  private _maePips: Pips | null;

  private constructor(
    readonly id: PositionId,
    readonly pair: CurrencyPair,
    readonly buySell: BuySell,
    readonly lot: Lot,
    readonly entryPrice: Price,
    readonly openedAt: Timestamp,
    readonly strategyName: StrategyName,
  ) {
    this._status = 'OPEN';
    this._exitPrice = null;
    this._closedAt = null;
    this._exitType = null;
    this._exitReason = null;
    this._profitLoss = null;
    this._mfePips = null;
    this._maePips = null;
  }

  static open(command: EntryCommand, result: EntryResult): Position {
    return new Position(
      result.positionId,
      command.pair,
      command.buySell,
      command.lot,
      result.entryPrice,
      result.executedAt,
      command.strategyName,
    );
  }

  /**
   * DB から復元する。
   * open() と違い、CLOSED 状態のポジションも復元できる。
   */
  static restore(params: {
    id: PositionId;
    pair: CurrencyPair;
    buySell: BuySell;
    lot: Lot;
    entryPrice: Price;
    openedAt: Timestamp;
    status: 'OPEN' | 'CLOSED';
    exitPrice?: Price;
    closedAt?: Timestamp;
    exitType?: ExitType;
    exitReason?: ExitReason;
    profitLoss?: Pips;
    mfePips?: Pips;
    maePips?: Pips;
    strategyName: StrategyName;
  }): Position {
    const position = new Position(
      params.id,
      params.pair,
      params.buySell,
      params.lot,
      params.entryPrice,
      params.openedAt,
      params.strategyName,
    );
    if (params.status === 'CLOSED') {
      position._status = 'CLOSED';
      position._exitPrice = params.exitPrice ?? null;
      position._closedAt = params.closedAt ?? null;
      position._exitType = params.exitType ?? null;
      position._exitReason = params.exitReason ?? null;
      position._profitLoss = params.profitLoss ?? null;
      position._mfePips = params.mfePips ?? null;
      position._maePips = params.maePips ?? null;
    }
    return position;
  }

  get status(): 'OPEN' | 'CLOSED' {
    return this._status;
  }

  get exitPrice(): Price | null {
    return this._exitPrice;
  }

  get closedAt(): Timestamp | null {
    return this._closedAt;
  }

  get exitType(): ExitType | null {
    return this._exitType;
  }

  get exitReason(): ExitReason | null {
    return this._exitReason;
  }

  get profitLoss(): Pips | null {
    return this._profitLoss;
  }

  get mfePips(): Pips | null {
    return this._mfePips;
  }

  get maePips(): Pips | null {
    return this._maePips;
  }

  /**
   * 決済前に MFE/MAE を確定させる。
   * ExtremeTracker が追跡した最高値/最安値から MFE/MAE を pips に変換する。
   * pip 単位は pipUnit(pair) で通貨ペアに応じて解決する。
   */
  applyExtremes(highest: Price, lowest: Price): void {
    if (this._status === 'CLOSED') return;

    const unit = pipUnit(this.pair);
    const entry = this.entryPrice.toBig();
    const high = highest.toBig();
    const low = lowest.toBig();

    if (this.buySell === 'BUY') {
      this._mfePips = Pips.of(high.minus(entry).div(unit).toFixed(4));
      this._maePips = Pips.of(entry.minus(low).div(unit).toFixed(4));
    } else {
      this._mfePips = Pips.of(entry.minus(low).div(unit).toFixed(4));
      this._maePips = Pips.of(high.minus(entry).div(unit).toFixed(4));
    }
  }

  close(command: ExitCommand, result: ExitResult): void {
    if (this._status === 'CLOSED') {
      throw new Error('既にクローズ済みのポジションです');
    }
    this._status = 'CLOSED';
    this._exitPrice = result.exitPrice;
    this._closedAt = result.executedAt;
    this._exitType = command.type;
    this._exitReason = command.reason;
    this._profitLoss = result.profitLoss;
  }

  /**
   * id で同一性を判断する。
   * 同じポジション ID を持つなら、他のフィールドが異なっていても同じポジションとみなす。
   */
  equals(other: Position): boolean {
    return this.id.equals(other.id);
  }
}
