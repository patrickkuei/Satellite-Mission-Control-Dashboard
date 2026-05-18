/**
 * Thin fetch wrapper for the `/health` endpoint. Lives in `src/api/` so
 * components/hooks never call `fetch` directly — the wrapper is the single
 * place where URL, method, and response shape are bound.
 */

/**
 * Mirror of the backend `HealthReport` interface. Duplicated locally rather
 * than imported from `@orbit-ctrl/api` to keep the frontend bundle free of
 * server code. Add to `@orbit-ctrl/types` if it grows shared consumers.
 */
export interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  timestamp: string;
  process: {
    uptimeSeconds: number;
    pid: number;
    memoryRssMb: number;
  };
}

/**
 * Fetch the current health snapshot from the API.
 *
 * @returns Parsed {@link HealthReport}.
 * @throws Error if the response status is not 2xx or the body is not JSON.
 *
 * @example
 * ```ts
 * const report = await fetchHealth();
 * console.warn(`API uptime: ${report.process.uptimeSeconds}s`);
 * ```
 */
import { apiBase } from './config';

export async function fetchHealth(): Promise<HealthReport> {
  const res = await fetch(`${apiBase}/health`);
  if (!res.ok) {
    throw new Error(`GET /api/health failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as HealthReport;
}
