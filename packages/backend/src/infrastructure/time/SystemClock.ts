import type { Clock } from '../../port/Clock.js';

/**
 * 本番用 `Clock` 実装。`new Date()` をそのまま返す。
 * テストでは Fake Clock に差し替えて、TTL や鮮度判定を決定論的に検証する。
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
