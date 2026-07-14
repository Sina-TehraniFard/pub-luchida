import { describe, it, expect } from 'vitest';
import { PositionId } from './PositionId.js';

describe('PositionId', () => {
  describe('生成', () => {
    it('generate() で新しい PositionId が生成される', () => {
      // Given: 特に前提なし

      // When: generate() で ID を生成する
      const id = PositionId.generate();

      // Then: PositionId インスタンスが返り、toString() で UUID 文字列が取り出せる
      expect(id).toBeInstanceOf(PositionId);
      expect(id.toString()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('generate() を2回呼ぶと異なる ID が生成される', () => {
      // Given: 特に前提なし

      // When: generate() を2回呼ぶ
      const id1 = PositionId.generate();
      const id2 = PositionId.generate();

      // Then: 2つの ID は異なる
      expect(id1.toString()).not.toBe(id2.toString());
    });

    it('from() に有効な UUID v4 文字列を渡すと PositionId が生成される', () => {
      // Given: UUID v4 形式の文字列（バージョン=4、バリアント=[89ab] を満たす例）
      const uuid = '550e8400-e29b-41d4-a716-446655440000';

      // When: from() で生成する
      const id = PositionId.from(uuid);

      // Then: 渡した文字列がそのまま取り出せる
      expect(id.toString()).toBe(uuid);
    });

    it('from() に任意の非空文字列を渡すと PositionId が生成される', () => {
      // Given: 数値文字列（ブローカーが返す ID）
      const brokerId = '67890';

      // When: from() で生成
      const id = PositionId.from(brokerId);

      // Then: 渡した文字列がそのまま取り出せる
      expect(id.toString()).toBe('67890');
    });

    it('from() に空文字を渡すとエラーが投げられる', () => {
      expect(() => PositionId.from('')).toThrow('空にできません');
    });

    it('from() に null を渡すとエラーが投げられる', () => {
      expect(() => PositionId.from(null as unknown as string)).toThrow();
    });

    it('from() に undefined を渡すとエラーが投げられる', () => {
      expect(() => PositionId.from(undefined as unknown as string)).toThrow();
    });
  });

  describe('等価比較', () => {
    it('同じ ID 文字列から生成した PositionId どうしは等価と判定される', () => {
      // Given: 同じ文字列から生成した2つの PositionId
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const a = PositionId.from(uuid);
      const b = PositionId.from(uuid);

      // When: equals() で比較する
      // Then: 同じ ID なので等価
      expect(a.equals(b)).toBe(true);
    });

    it('異なる ID 文字列から生成した PositionId どうしは非等価と判定される', () => {
      // Given: 異なる文字列から生成した2つの PositionId
      const a = PositionId.from('550e8400-e29b-41d4-a716-446655440000');
      const b = PositionId.from('6ba7b810-9dad-41d1-80b4-00c04fd430c8');

      // When / Then: 異なる ID なので非等価
      expect(a.equals(b)).toBe(false);
    });

    it('generate() してから from(id.toString()) で復元すると等価と判定される（DB往復の模擬）', () => {
      // Given: generate() で生成した ID
      const original = PositionId.generate();

      // When: toString() で文字列化し、from() で復元する
      const restored = PositionId.from(original.toString());

      // Then: 元の ID と復元した ID は等価
      expect(original.equals(restored)).toBe(true);
    });
  });

  describe('compareTo（辞書順比較）', () => {
    it('this の value が other より小さい場合は負を返す', () => {
      // Given: 文字列辞書順で a < b の関係を持つ 2 つの PositionId
      const a = PositionId.from('aaa');
      const b = PositionId.from('bbb');

      // When / Then: compareTo は負を返す
      expect(a.compareTo(b)).toBeLessThan(0);
    });

    it('this の value が other より大きい場合は正を返す', () => {
      // Given: 文字列辞書順で b > a の関係
      const a = PositionId.from('aaa');
      const b = PositionId.from('bbb');

      // When / Then: compareTo は正を返す
      expect(b.compareTo(a)).toBeGreaterThan(0);
    });

    it('this と other の value が等しい場合は 0 を返す', () => {
      // Given: 同じ value の 2 つの PositionId
      const a = PositionId.from('same');
      const b = PositionId.from('same');

      // When / Then: compareTo は 0 を返す
      expect(a.compareTo(b)).toBe(0);
    });

    it('反対称性: a.compareTo(b) と b.compareTo(a) は符号が反対になる', () => {
      // Given: 任意の 2 つの異なる PositionId
      const a = PositionId.from('aaa');
      const b = PositionId.from('bbb');

      // When: 双方向に compareTo を呼ぶ
      const ab = a.compareTo(b);
      const ba = b.compareTo(a);

      // Then: 符号が反対
      expect(Math.sign(ab)).toBe(-Math.sign(ba));
    });

    it('推移性: a < b かつ b < c のとき a < c', () => {
      // Given: 辞書順で a < b < c の 3 つの PositionId
      const a = PositionId.from('aaa');
      const b = PositionId.from('bbb');
      const c = PositionId.from('ccc');

      // When / Then: 推移性が成立する
      expect(a.compareTo(b)).toBeLessThan(0);
      expect(b.compareTo(c)).toBeLessThan(0);
      expect(a.compareTo(c)).toBeLessThan(0);
    });

    it('決定論性: 同じ入力に対して常に同じ結果を返す', () => {
      // Given: 同じ 2 つの PositionId
      const a = PositionId.from('xxx');
      const b = PositionId.from('yyy');

      // When: compareTo を複数回呼ぶ
      const first = a.compareTo(b);
      const second = a.compareTo(b);

      // Then: 結果は常に同じ
      expect(first).toBe(second);
    });
  });
});
