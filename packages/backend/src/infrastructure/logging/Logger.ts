import type { LogPort } from '../../domain/port/LogPort.js';
import { formatInDisplayTimeZone } from '../time/TimeZone.js';

/**
 * 構造化ログ出力（`LogPort` の本番実装）。
 * LOG_LEVEL 環境変数でフィルタリング（デフォルト: INFO）。
 * DEBUG ログは LOG_LEVEL=DEBUG のときだけ出力。
 */

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const CURRENT_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'INFO';

export class Logger implements LogPort {
  /**
   * @param context ログの発生源（クラス名）
   * @param category ログの話題。UI のタブ分けの軸（level は重大度、category はトピック）
   */
  constructor(
    private readonly context: string,
    private readonly category: LogCategory = 'SYSTEM',
  ) {}

  debug(message: string, data?: Record<string, unknown>): void {
    this.write('DEBUG', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write('INFO', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write('WARN', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write('ERROR', message, data);
  }

  private write(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[CURRENT_LEVEL]) return;

    const entry: LogEntry = {
      timestamp: formatInDisplayTimeZone(new Date()),
      level,
      category: this.category,
      context: this.context,
      message,
      ...(data !== undefined ? { data } : {}),
    };

    const output = JSON.stringify(entry);

    if (level === 'ERROR') {
      console.error(output);
    } else if (level === 'WARN') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * ログの話題（UI のタブ分けの軸）。
 *
 * **レイヤーではなく話題で分類する**（発生源のクラス＝レイヤーは context が既に示している）。
 * 例: GmoBrokerAdapter は adapter 層だが、出すログは注文送信・約定という
 * 取引ライフサイクルの話題なので TRADE。通信の仕組み（REST/WS/スロットル）の話題だけが BROKER。
 *
 * - TRADE: エントリー判定・発注・決済・緊急全決済（取引に何が起きたか）
 * - MARKET: 足確定・tick・指標（市場で何が起きたか）
 * - BROKER: 外部 API 通信の仕組み（REST / WebSocket / レート制限 / 残高取得）
 * - SYSTEM: 起動停止・DB・sync・ログ管理（運用基盤で何が起きたか）
 */
export type LogCategory = 'TRADE' | 'MARKET' | 'BROKER' | 'SYSTEM';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  context: string;
  message: string;
  data?: Record<string, unknown>;
}
