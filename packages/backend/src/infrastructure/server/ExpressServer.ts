import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { Logger } from '../logging/Logger.js';
import type { PositionRepository } from '../../port/PositionRepository.js';
import type { GmoRestClient } from '../../adapter/gmo/GmoRestClient.js';
import type { GmoAssetsData } from '../../adapter/gmo/GmoBalanceAdapter.js';
import type { SyncPositionsUseCase } from '../../application/SyncPositionsUseCase.js';
import { EmergencyCloseInProgressError } from '../../application/EmergencyCloseAllUseCase.js';
import type { EmergencyCloseAllUseCase } from '../../application/EmergencyCloseAllUseCase.js';

/**
 * Express + socket.io サーバー。
 * UIは監視専用。取引はバックエンドが自動で行う。
 */
export class ExpressServer {
  private readonly logger = new Logger('ExpressServer');
  private readonly app = express();
  private readonly httpServer = createServer(this.app);
  readonly io: SocketIOServer;

  // 起動時認証チェックの結果（#290）。未検証なら 'unknown'。
  // /api/health で公開し、luchida -c が「正しい設定で起動したか」まで確認できるようにする。
  private authStatus: 'ok' | 'failed' | 'unknown' = 'unknown';

  // TODO(#52): 残る restClient 直接参照（資産・履歴系の読み取り API）を Port 経由に変更する
  constructor(
    private readonly port: number = 7778,
    private readonly positionRepository?: PositionRepository,
    private readonly restClient?: GmoRestClient,
    private readonly syncPositions?: SyncPositionsUseCase,
    private readonly emergencyCloseAll?: EmergencyCloseAllUseCase,
    /** /api/logs が読むログファイル。PM2 の出力先（ecosystem.config.cjs の LOG_FILE）と一致させる */
    private readonly logFilePath?: string,
  ) {
    this.app.use(cors({ origin: 'http://localhost:7777' }));
    this.app.use(express.json());

    // Bearer トークン認証（/api/health 以外の /api/* エンドポイント）
    const apiToken = process.env.API_TOKEN;
    if (apiToken) {
      this.app.use('/api', (req: Request, res: Response, next: NextFunction) => {
        if (req.path === '/health') {
          next();
          return;
        }
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${apiToken}`) {
          res.status(401).json({ error: '認証失敗' });
          return;
        }
        next();
      });
    }

    this.io = new SocketIOServer(this.httpServer, {
      cors: { origin: 'http://localhost:7777' },
    });

    this.setupRoutes();
    this.setupSocketIO();
  }

  private setupRoutes(): void {
    this.app.get('/api/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', auth: this.authStatus, timestamp: new Date().toISOString() });
    });

    // ボットログ取得（直近N行）
    this.app.get('/api/logs', async (req: Request, res: Response) => {
      try {
        if (!this.logFilePath) {
          res.json({ lines: [], total: 0 });
          return;
        }
        const { readFile } = await import('node:fs/promises');
        const lines = Number(req.query.lines) || 200;
        const content = await readFile(this.logFilePath, 'utf-8').catch(() => '');
        const allLines = content.split('\n').filter(Boolean);
        const tail = allLines.slice(-lines);
        res.json({ lines: tail, total: allLines.length });
      } catch {
        res.json({ lines: [], total: 0 });
      }
    });

    // 現在の保有ポジション
    this.app.get('/api/positions', async (_req: Request, res: Response) => {
      try {
        if (!this.positionRepository) {
          res.status(503).json({ error: 'Repository 未設定' });
          return;
        }
        const openPositions = await this.positionRepository.openPositions();
        const list: unknown[] = [];
        openPositions.forEach((p) => {
          list.push({
            id: p.id.toString(),
            pair: p.pair,
            side: p.buySell,
            lot: p.lot.toString(),
            entryPrice: p.entryPrice.toString(),
            openedAt: p.openedAt.toString(),
            status: p.status,
          });
        });
        res.json(list);
      } catch (err: unknown) {
        this.logger.error('ポジション取得失敗', { error: String(err) });
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    });

    // 口座資産（GMO FX /account/assets API）
    // FX の同エンドポイントは資産サマリを単一オブジェクトで返す（data がそのまま GmoAssetsData）。
    this.app.get('/api/assets', async (_req: Request, res: Response) => {
      try {
        if (!this.restClient) {
          res.status(503).json({ error: 'RestClient 未設定' });
          return;
        }
        const assetsRes = await this.restClient.get<GmoAssetsData>(
          '/private/v1/account/assets',
        );
        res.json(assetsRes.data);
      } catch (err: unknown) {
        this.logger.error('資産情報取得失敗', { error: String(err) });
        res.status(500).json({ error: String(err) });
      }
    });

    // 取引履歴（GMO約定履歴ベース）
    this.app.get('/api/history', async (_req: Request, res: Response) => {
      try {
        if (!this.restClient) {
          res.status(503).json({ error: 'RestClient 未設定' });
          return;
        }
        const execRes = await this.restClient.get<{ list: GmoExecution[] }>(
          '/private/v1/latestExecutions',
          { symbol: 'USD_JPY', count: '50' },
        );
        const executions = execRes.data?.list ?? [];

        res.json(executions.map(ex => ({
          id: ex.executionId,
          side: ex.side,
          settleType: ex.settleType,
          size: ex.size,
          price: ex.price,
          lossGain: ex.lossGain,
          timestamp: ex.timestamp,
        })));
      } catch (err: unknown) {
        this.logger.error('取引履歴取得失敗', { error: String(err) });
        res.status(500).json({ error: String(err) });
      }
    });

    // 損益推移（GMO約定履歴ベース）
    this.app.get('/api/equity', async (_req: Request, res: Response) => {
      try {
        if (!this.restClient) {
          res.status(503).json({ error: 'RestClient 未設定' });
          return;
        }

        // GMO の直近約定を取得
        const execRes = await this.restClient.get<{ list: GmoExecution[] }>(
          '/private/v1/latestExecutions',
          { symbol: 'USD_JPY', count: '100' },
        );
        const executions = execRes.data?.list ?? [];

        // 決済（CLOSE）のみ抽出して日次集計
        const dailyMap = new Map<string, number>();
        for (const ex of executions) {
          if (ex.settleType !== 'CLOSE') continue;
          const date = ex.timestamp.slice(0, 10);
          const pnl = Number(ex.lossGain ?? 0);
          dailyMap.set(date, (dailyMap.get(date) ?? 0) + pnl);
        }

        // 日付順にソートして累計を計算
        const dates = [...dailyMap.keys()].sort();
        let cumulative = 0;
        const result = dates.map(date => {
          cumulative += dailyMap.get(date)!;
          return {
            date,
            daily_pnl: dailyMap.get(date)!.toFixed(1),
            cumulative_pnl: cumulative.toFixed(1),
          };
        });

        res.json(result);
      } catch (err: unknown) {
        this.logger.error('損益推移取得失敗', { error: String(err) });
        res.status(500).json({ error: String(err) });
      }
    });

    // 緊急全決済（ロジックは EmergencyCloseAllUseCase に委譲）
    this.app.post('/api/emergency-close-all', async (_req: Request, res: Response) => {
      try {
        if (!this.emergencyCloseAll) {
          res.status(503).json({ error: 'EmergencyCloseAllUseCase 未設定' });
          return;
        }

        const result = await this.emergencyCloseAll.execute();

        if (result.total === 0) {
          res.json({ message: '保有ポジションなし', closed: 0 });
          return;
        }

        this.io.emit('emergency:closed', {
          closed: result.closed.length,
          errors: result.errors.length,
          unresolved: result.unresolved.length,
        });

        res.json({
          closed: result.closed.length,
          errors: result.errors,
          results: result.closed,
          // タイムアウト時点で結果未確定のポジション id（ブローカー側での要確認対象）
          unresolved: result.unresolved,
        });
      } catch (err: unknown) {
        if (err instanceof EmergencyCloseInProgressError) {
          res.status(409).json({ error: err.message });
          return;
        }
        this.logger.error('緊急全決済失敗', { error: String(err) });
        res.status(500).json({ error: String(err) });
      }
    });

    // ブローカー建玉とDB同期（ロジックは SyncPositionsUseCase に委譲）
    this.app.post('/api/sync', async (_req: Request, res: Response) => {
      try {
        if (!this.syncPositions) {
          res.status(503).json({ error: 'SyncPositionsUseCase 未設定' });
          return;
        }

        const result = await this.syncPositions.execute();

        // サマリログは SyncPositionsUseCase が出す（HTTP 変換に専念）
        this.io.emit('sync:completed', { synced: result.synced });

        res.json({
          message: `同期完了: ${result.synced}件のDBポジションをCLOSEDに更新`,
          dbOpen: result.dbOpen,
          gmoOpen: result.brokerOpen,
          synced: result.synced,
        });
      } catch (err: unknown) {
        this.logger.error('同期失敗', { error: String(err) });
        res.status(500).json({ error: String(err) });
      }
    });
  }

  private setupSocketIO(): void {
    this.io.on('connection', (socket) => {
      this.logger.info('WebSocket クライアント接続', { id: socket.id });
      socket.on('disconnect', () => {
        this.logger.info('WebSocket クライアント切断', { id: socket.id });
      });
    });
  }

  /**
   * 起動シーケンスで実施した認証チェックの結果を記録する（#290）。
   * /api/health がこの値を返し、luchida -c が認証状態まで監視できる。
   */
  reportAuthStatus(status: 'ok' | 'failed'): void {
    this.authStatus = status;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        this.logger.info(`Express :${this.port} 起動`, { port: this.port });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.io.close();
      this.httpServer.close(() => {
        this.logger.info('サーバー停止');
        resolve();
      });
    });
  }
}

interface GmoExecution {
  executionId: number;
  orderId: number;
  symbol: string;
  side: string;
  settleType: string;
  size: string;
  price: string;
  lossGain?: string;
  timestamp: string;
}
