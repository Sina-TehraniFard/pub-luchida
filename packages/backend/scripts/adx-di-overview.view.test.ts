import { describe, it, expect } from 'vitest';
import {
  ANSI,
  createPaint,
  CellOutcome,
  formatValue,
  displayWidth,
  padEndDisplayWidth,
} from './adx-di-overview.view.js';
import { TrendStrength } from '../src/domain/market/indicator/TrendStrength.js';
import { AdxValue } from '../src/domain/market/indicator/AdxValue.js';
import { DiPlus, DiMinus } from '../src/domain/market/indicator/DiValue.js';

function measured(adx: string, diPlus = '30', diMinus = '10'): CellOutcome {
  return {
    kind: 'measured',
    strength: TrendStrength.of({
      adx: AdxValue.of(adx),
      diPlus: DiPlus.of(diPlus),
      diMinus: DiMinus.of(diMinus),
    }),
  };
}

const color = createPaint(true);
const plain = createPaint(false);

describe('createPaint', () => {
  it('有効時はコードで挟み reset で閉じる', () => {
    expect(color('abc', ANSI.red)).toBe(`${ANSI.red}abc${ANSI.reset}`);
  });

  it('無効時は装飾しない', () => {
    expect(plain('abc', ANSI.red, ANSI.bold)).toBe('abc');
  });
});

describe('formatValue', () => {
  it('取得失敗は赤で表示する', () => {
    const outcome: CellOutcome = { kind: 'fetchFailed', message: 'boom' };
    expect(formatValue(outcome, color)).toBe(`${ANSI.red}取得失敗${ANSI.reset}`);
    expect(formatValue(outcome, plain)).toBe('取得失敗');
  });

  it('データ不足はグレーで表示する', () => {
    const outcome: CellOutcome = { kind: 'insufficientData' };
    expect(formatValue(outcome, color)).toBe(`${ANSI.gray}(データ不足)${ANSI.reset}`);
    expect(formatValue(outcome, plain)).toBe('(データ不足)');
  });

  it('計測値は ADX/DI と向きを表示する（色無効ならプレーン）', () => {
    expect(formatValue(measured('25', '30', '10'), plain)).toBe(
      'ADX= 25.0  +DI= 30.0  -DI= 10.0  ↑上昇',
    );
    expect(formatValue(measured('25', '10', '30'), plain)).toBe(
      'ADX= 25.0  +DI= 10.0  -DI= 30.0  ↓下降',
    );
    expect(formatValue(measured('25', '20', '20'), plain)).toBe(
      'ADX= 25.0  +DI= 20.0  -DI= 20.0  →中立',
    );
  });

  it('ADX 20 未満は薄字（境界 19.9 / 20.0）', () => {
    expect(formatValue(measured('19.9'), color)).toContain(`${ANSI.dim} 19.9${ANSI.reset}`);
    expect(formatValue(measured('20'), color)).not.toContain(ANSI.dim);
  });

  it('ADX 40 以上は太字（境界 39.9 / 40.0）', () => {
    expect(formatValue(measured('39.9'), color)).not.toContain(ANSI.bold);
    expect(formatValue(measured('40'), color)).toContain(
      `${ANSI.bold}${ANSI.yellow} 40.0${ANSI.reset}`,
    );
  });

  it('色無効なら ANSI コードを一切含まない', () => {
    for (const adx of ['19.9', '20', '39.9', '40']) {
      expect(formatValue(measured(adx), plain)).not.toContain('\x1b[');
    }
  });
});

describe('displayWidth / padEndDisplayWidth', () => {
  it('全角=2、半角=1 で数える', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('日足')).toBe(4);
    expect(displayWidth('1時間足')).toBe(7);
    expect(displayWidth('15分足')).toBe(6);
  });

  it('全角混じりでも同じ表示幅に揃う', () => {
    expect(padEndDisplayWidth('1時間足', 8)).toBe('1時間足 ');
    expect(padEndDisplayWidth('日足', 8)).toBe('日足    ');
    expect(padEndDisplayWidth('15分足', 8)).toBe('15分足  ');
  });

  it('幅を超える文字列は切り詰めず余白なしで返す', () => {
    expect(padEndDisplayWidth('1時間足', 4)).toBe('1時間足');
  });
});
