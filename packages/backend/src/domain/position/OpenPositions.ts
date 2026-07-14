import { currencyPairEquals, type CurrencyPair } from '../market/CurrencyPair.js';
import type { Position } from './Position.js';
import type { PositionId } from './PositionId.js';
import {
  strategyNameEquals,
  type StrategyName,
  type StrategyNameValue,
} from '../rule/StrategyName.js';

/**
 * 現在保有中のポジション一覧。
 * ファーストクラスコレクション。
 * Position の配列をそのまま扱わず、ドメインの意図を持ったメソッドを提供する。
 */
export class OpenPositions {
  private constructor(private readonly positions: readonly Position[]) {}

  /** ポジションなし */
  static empty(): OpenPositions {
    return new OpenPositions([]);
  }

  /**
   * 既存ポジションから生成。
   * 同一 PositionId を含む配列は不変条件違反として throw する（`add` と同じガード）。
   */
  static of(positions: readonly Position[]): OpenPositions {
    const seen = new Set<string>();
    for (const p of positions) {
      const key = p.id.toString();
      if (seen.has(key)) {
        throw new Error(`同じ PositionId のポジションが複数含まれています: ${key}`);
      }
      seen.add(key);
    }
    return new OpenPositions([...positions]);
  }

  /**
   * 指定した通貨ペアのポジションを保有中か。
   * EntryRule が「既にポジションがあるか」を確認するのに使う。
   */
  hasPositionFor(pair: CurrencyPair): boolean {
    return this.positions.some((p) => currencyPairEquals(p.pair, pair));
  }

  /**
   * 指定した通貨ペアで現在保有中の戦略名集合を返す（読み取り専用）。
   * 集合一括取得のユースケース向け。単発の保有判定は `holdsStrategyOnPair` を使う。
   */
  heldStrategyNamesFor(pair: CurrencyPair): ReadonlySet<StrategyNameValue> {
    const held = new Set<StrategyNameValue>();
    for (const p of this.positions) {
      if (currencyPairEquals(p.pair, pair)) {
        held.add(p.strategyName);
      }
    }
    return held;
  }

  /**
   * 指定 pair × 指定 strategy のポジションを保有中か（Tell, Don't Ask）。
   * AllocationPolicy が「同 pair × 同戦略の重複ポジション抑制」を単発判定する用途。
   */
  holdsStrategyOnPair(pair: CurrencyPair, strategy: StrategyName): boolean {
    return this.positions.some(
      (p) => currencyPairEquals(p.pair, pair) && strategyNameEquals(p.strategyName, strategy),
    );
  }

  /**
   * 指定した通貨ペアのポジションのみを含む新しい OpenPositions を返す（自己同型・不変）。
   * ExitDispatcher が pair-bound 評価を行うための射影。
   * 設計書: docs/design/position-manager/step8-brief.md 5.2 / 5.3。
   */
  forPair(pair: CurrencyPair): OpenPositions {
    return new OpenPositions(this.positions.filter((p) => currencyPairEquals(p.pair, pair)));
  }

  /**
   * 全 pair の保有戦略名集合を返す（読み取り専用）。
   * `heldStrategyNamesFor(pair)` の全 pair 版。
   * 起動時 fail-fast 検証（main.ts）が「保有戦略 ⊆ Registry 登録戦略」を判定する用途。
   * 設計書: docs/design/position-manager/step8-brief.md 5.6。
   */
  heldStrategyNames(): ReadonlySet<StrategyNameValue> {
    const held = new Set<StrategyNameValue>();
    for (const p of this.positions) {
      held.add(p.strategyName);
    }
    return held;
  }

  /**
   * 指定した id 群に含まれないポジションのみの OpenPositions を返す（自己同型・不変）。
   * SyncPositionsUseCase が「ブローカーに現存しない（= 外部で決済済みの）ポジション」を
   * 検出するための射影。
   * 設計書: docs/design/sequence/core/usecase-layer.md「建玉同期」。
   */
  missingFrom(ids: readonly PositionId[]): OpenPositions {
    return new OpenPositions(
      this.positions.filter((p) => !ids.some((id) => id.equals(p.id))),
    );
  }

  /**
   * `openedAt` 昇順で並べた新しい OpenPositions を返す（自己同型・不変）。
   * ExitDispatcher の評価順を決定論化するために使う。
   *
   * 同 `openedAt` の場合は **任意かつ決定論的な** 順で並べる必要があるため、
   * 二次キーとして `PositionId.compareTo`（id 文字列の辞書順）を採用する。
   * 二次キー自体に業務的意味はなく、決定論性のみが目的（step8-brief.md 5.8）。
   *
   * 設計書: docs/design/position-manager/step8-brief.md 5.5 / 5.8。
   */
  sortedByOpenedAtAsc(): OpenPositions {
    const sorted = [...this.positions].sort((a, b) => {
      if (a.openedAt.isBefore(b.openedAt)) return -1;
      if (a.openedAt.isAfter(b.openedAt)) return 1;
      return a.id.compareTo(b.id);
    });
    return new OpenPositions(sorted);
  }

  /**
   * 指定した PositionId のポジションを取得する。
   * 存在しない場合は Error をスローする（決済フローの整合性バグを即座に検出）。
   */
  getById(id: PositionId): Position {
    const found = this.positions.find((p) => p.id.equals(id));
    if (found === undefined) {
      throw new Error(`指定した PositionId のポジションが存在しません: ${id.toString()}`);
    }
    return found;
  }

  /** 保有ポジション数 */
  count(): number {
    return this.positions.length;
  }

  /** 各ポジションに対して処理を実行する */
  forEach(consumer: (position: Position) => void): void {
    this.positions.forEach(consumer);
  }

  /** ポジションが一つも存在しないか */
  isEmpty(): boolean {
    return this.positions.length === 0;
  }

  /** for...of で反復可能にする */
  [Symbol.iterator](): Iterator<Position> {
    return this.positions[Symbol.iterator]();
  }

  /** ポジションを追加した新しい OpenPositions を返す（不変） */
  add(position: Position): OpenPositions {
    if (this.positions.some((p) => p.id.equals(position.id))) {
      throw new Error(`同じ PositionId のポジションが既に存在します: ${position.id.toString()}`);
    }
    return new OpenPositions([...this.positions, position]);
  }

  /** 指定した id のポジションを除いた新しい OpenPositions を返す（不変） */
  remove(id: PositionId): OpenPositions {
    const exists = this.positions.some((p) => p.id.equals(id));
    if (!exists) {
      throw new Error(`指定した PositionId のポジションが存在しません: ${id.toString()}`);
    }
    return new OpenPositions(this.positions.filter((p) => !p.id.equals(id)));
  }

  /**
   * 同一の保有ポジション集合か（順序非依存）。
   * 各ポジションは PositionId で同一性を判定する（VO 等価性は id ベース）。
   * `of` / `add` で同一 id 重複は不変条件違反として弾かれているため、
   * 等しい長さ + this の全 id が other に含まれることで集合一致が確定する。
   */
  equals(other: OpenPositions): boolean {
    if (this.positions.length !== other.positions.length) return false;
    const otherIds = new Set(other.positions.map((p) => p.id.toString()));
    return this.positions.every((p) => otherIds.has(p.id.toString()));
  }

  /** ログ用の簡易表現（件数のみ）。Position 全体は出さない */
  toString(): string {
    return `OpenPositions(n=${this.positions.length})`;
  }
}
