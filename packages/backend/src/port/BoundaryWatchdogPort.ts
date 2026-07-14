/**
 * 足境界の壁時計（BarBoundaryWatchdog）のライフサイクル契約。
 *
 * TradingSession は「境界ごとに照合を起こす何か」を start / stop できればよく、
 * その実体（setTimeout 駆動の BoundaryScheduler 等）を知る必要はない。
 * テストでは no-op 実装（NoopBoundaryWatchdog）を注入する。
 */
export interface BoundaryWatchdogPort {
  start(): void;
  stop(): void;
}

/** 何もしない壁時計。境界照合が不要なテスト・構成で使う Null Object。 */
export const NoopBoundaryWatchdog: BoundaryWatchdogPort = {
  start(): void {},
  stop(): void {},
};
