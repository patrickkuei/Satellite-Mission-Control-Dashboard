/**
 * Health repository — owns the persisted/process-level facts used by the
 * liveness probe. For Phase 0 there is no real persistence; this repository
 * exposes process metadata (uptime, pid) so the {@link HealthService} has a
 * stable interface to consume even as we add real storage (Redis, file
 * caches) later.
 *
 * Repositories may only be called by services. Never import this file from
 * routes or controllers directly.
 */
import type { ProcessHealthSnapshot } from '@orbit-ctrl/types';

/**
 * Repository façade for process-level health data.
 *
 * @example
 * ```ts
 * const repo = createHealthRepository();
 * const snapshot = repo.getProcessSnapshot();
 * // → { uptimeSeconds: 42.1, pid: 12345, memoryRssMb: 87.3 }
 * ```
 */
export interface HealthRepository {
  /** Read the current process health snapshot. Synchronous — no I/O. */
  getProcessSnapshot(): ProcessHealthSnapshot;
}

/**
 * Build a {@link HealthRepository} backed by Node's `process` global.
 *
 * @returns A repository instance suitable for injection into the health service.
 */
export function createHealthRepository(): HealthRepository {
  return {
    getProcessSnapshot() {
      const mem = process.memoryUsage();
      return {
        uptimeSeconds: process.uptime(),
        pid: process.pid,
        memoryRssMb: Number((mem.rss / 1024 / 1024).toFixed(2)),
      };
    },
  };
}
