/**
 * 全通貨ペア × 各時間足の ADX / +DI / −DI を一覧出力する CLI スクリプト。
 *
 * 「いま実際に一番トレンドが乗っている通貨ペアはどれか」を人間が一目で判断するための
 * 参考表示。あくまで参考情報であり、自動売買の通貨選択ロジックには一切組み込まない（#246）。
 *
 * 表示:
 *   - 取得中は進捗ゲージ（プログレスバー）を stderr に1行更新で表示する。
 *   - 全取得後、ADX の強さと向き（↑上昇/↓下降）を色分けした表を stdout に一括表示する。
 *   - 取得失敗があった場合は表の後に詳細（pair × 時間足 × エラー内容）を列挙する。
 *   - stdout / stderr が TTY でない（パイプ・リダイレクト）ときは色・ゲージを自動で抑制する。
 *
 * 設計:
 *   - データ取得は既存 GmoCandleHistoryAdapter を流用（pair を渡して全ペアを逐次取得）。
 *   - ADX/DI 計算は trading-signals を使う TradingSignalsAdxCalculator。
 *   - 時間足は統合せず各足を個別に表示する（総合判断は人間に委ねる）。
 *   - 本番取引の API 枠を圧迫しないよう、ペア × 足を逐次・低頻度で取得する。
 *   - 表示の整形処理（テスト対象）は adx-di-overview.view.ts に分離している。
 *
 * 実行:
 *   luchida adx [--period 14] [--bars 200]            （推奨。どのディレクトリからでも可）
 *   node --import tsx scripts/adx-di-overview.ts ...  （直接実行する場合は packages/backend を cwd にする）
 *
 * 引数:
 *   --period N  ADX/DI 期間（正の整数、既定 14）
 *   --bars N    各足で取得する確定足の本数（既定 200。period より十分多く取る）
 *
 * klines は Public API のため API キー不要。
 */
import { GmoRestClient } from '../src/adapter/gmo/GmoRestClient.js';
import { GmoCandleHistoryAdapter } from '../src/adapter/gmo/GmoCandleHistoryAdapter.js';
import { TradingSignalsAdxCalculator } from '../src/adapter/indicator/TradingSignalsAdxCalculator.js';
import { SystemClock } from '../src/infrastructure/time/SystemClock.js';
import { TimeFrame, LIVE_TIMEFRAMES, label as tfLabel } from '../src/domain/market/TimeFrame.js';
import { CurrencyPair, BUSINESS_PAIRS_LIST } from '../src/domain/market/CurrencyPair.js';
import { AdxPeriod } from '../src/domain/market/indicator/AdxPeriod.js';
import {
  ANSI,
  createPaint,
  CellOutcome,
  formatValue,
  padEndDisplayWidth,
} from './adx-di-overview.view.js';

const DEFAULT_BARS = 200;

// 時間足ラベル列の表示幅（全角=2 で数える）。最長の「1時間足」= 7 に余白1。
const TIMEFRAME_LABEL_WIDTH = 8;

// 進捗ゲージのバー幅（文字数）。
const GAUGE_WIDTH = 24;

interface CliOptions {
  period: AdxPeriod;
  bars: number;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let period = AdxPeriod.DEFAULT;
  let bars = DEFAULT_BARS;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--period') {
      const raw = argv[++i];
      period = AdxPeriod.of(Number(raw));
    } else if (arg === '--bars') {
      const raw = argv[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--bars は正の整数: ${raw}`);
      }
      bars = n;
    } else {
      throw new Error(`未対応の引数: ${arg}`);
    }
  }

  return { period, bars };
}

// ===================== 色（ANSI） =====================
// stdout が TTY のときだけ色を付ける。パイプ・リダイレクトでは化けないよう抑制。
const paint = createPaint(process.stdout.isTTY === true);
// ゲージは stderr に出す（結果の stdout を汚さない）。stderr が TTY のときだけ動かす。
const useGauge = process.stderr.isTTY === true;

// ===================== 取得結果の保持 =====================
interface Cell {
  timeFrame: TimeFrame;
  outcome: CellOutcome;
}
interface Row {
  pair: CurrencyPair;
  cells: Cell[];
}

// ===================== 進捗ゲージ =====================
function renderGauge(done: number, total: number, current: string): void {
  if (!useGauge) return;
  const ratio = total === 0 ? 1 : done / total;
  const filled = Math.round(ratio * GAUGE_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(GAUGE_WIDTH - filled);
  const pct = Math.round(ratio * 100)
    .toString()
    .padStart(3);
  // \r で行頭に戻して上書き。末尾に余白を付けて前回の残り文字を消す。
  process.stderr.write(`\r[${bar}] ${pct}% ${done}/${total}  ${current.padEnd(20)}`);
}

function clearGauge(): void {
  if (!useGauge) return;
  // \r で行頭に戻り、ANSI の行消去（EL2）でゲージ行を丸ごと消す。
  process.stderr.write('\r\x1b[2K');
}

// ===================== 表の描画 =====================
function renderTable(rows: Row[], period: AdxPeriod, bars: number): void {
  const title = `=== 全通貨ペア トレンド強度（ADX/DI）一覧 期間=${period} 取得本数=${bars} ===`;
  console.log(paint(title, ANSI.bold));
  console.log(paint('（参考表示。自動売買の通貨選択には使用しない）', ANSI.gray));
  // paint はネスト不可のため、凡例は断片ごとに個別に paint して連結する。
  const legend = [
    paint('凡例:', ANSI.gray),
    paint('↑上昇', ANSI.green),
    paint('↓下降', ANSI.red),
    paint('→中立', ANSI.gray),
    paint(' /  ADX', ANSI.gray),
    paint('太字=非常に強い(≥40)', ANSI.bold, ANSI.yellow),
    paint('薄字=弱い(<20)', ANSI.dim),
  ].join(' ');
  console.log(legend);
  console.log('');

  for (const row of rows) {
    console.log(paint(row.pair, ANSI.bold));
    for (const cell of row.cells) {
      const tf = padEndDisplayWidth(tfLabel(cell.timeFrame), TIMEFRAME_LABEL_WIDTH);
      console.log(`    ${tf} ${formatValue(cell.outcome, paint)}`);
    }
    console.log('');
  }
}

/** 取得失敗があった場合のみ、表の後に pair × 時間足 × エラー内容を列挙する。 */
function renderFailureDetails(rows: Row[]): void {
  const failures: { pair: CurrencyPair; timeFrame: TimeFrame; message: string }[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.outcome.kind === 'fetchFailed') {
        failures.push({
          pair: row.pair,
          timeFrame: cell.timeFrame,
          message: cell.outcome.message,
        });
      }
    }
  }
  if (failures.length === 0) return;

  console.log(paint('=== 取得失敗の詳細 ===', ANSI.bold));
  for (const failure of failures) {
    const tf = padEndDisplayWidth(tfLabel(failure.timeFrame), TIMEFRAME_LABEL_WIDTH);
    console.log(`    ${failure.pair} ${tf} ${paint(failure.message, ANSI.red)}`);
  }
  console.log('');
}

async function main(): Promise<void> {
  const { period, bars } = parseArgs(process.argv.slice(2));

  // klines は Public API のため鍵不要。空文字で生成する。
  const restClient = new GmoRestClient('', '');
  const clock = new SystemClock();
  const calculator = new TradingSignalsAdxCalculator();

  const total = BUSINESS_PAIRS_LIST.length * LIVE_TIMEFRAMES.length;
  let done = 0;
  const rows: Row[] = [];

  for (const pairStr of BUSINESS_PAIRS_LIST) {
    const pair = CurrencyPair(pairStr);
    const adapter = new GmoCandleHistoryAdapter(restClient, clock, pair);
    const cells: Cell[] = [];

    for (const timeFrame of LIVE_TIMEFRAMES) {
      renderGauge(done, total, `${pair} ${tfLabel(timeFrame)}`);
      let outcome: CellOutcome;
      try {
        const candles = await adapter.fetchRecent(timeFrame, bars);
        const strength = calculator.calculate(candles, period);
        outcome = strength === null ? { kind: 'insufficientData' } : { kind: 'measured', strength };
      } catch (err) {
        outcome = { kind: 'fetchFailed', message: String(err) };
      }
      cells.push({ timeFrame, outcome });
      done++;
      renderGauge(done, total, `${pair} ${tfLabel(timeFrame)}`);
    }
    rows.push({ pair, cells });
  }

  clearGauge();
  renderTable(rows, period, bars);
  renderFailureDetails(rows);
}

main().catch((err) => {
  console.error('ADX/DI 一覧の生成に失敗しました:', err);
  process.exit(1);
});
