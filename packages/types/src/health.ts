/**
 * Health probe contract returned by `GET /health`.
 *
 * Used by deployment platforms (Fly.io) for liveness checks and by the
 * frontend status indicator. Reserved `status: 'degraded'` for future
 * partial-outage states (e.g., NOAA SWPC unreachable but TLE cache fresh).
 *
 * @packageDocumentation
 */
import { z } from 'zod';

/** Process-level health facts (uptime, memory). */
export const ProcessHealthSnapshotSchema = z
  .object({
    /** Seconds since the Node process started. */
    uptimeSeconds: z.number().nonnegative(),
    /** Operating-system process ID. */
    pid: z.number().int().positive(),
    /** Resident set size in megabytes (rough working memory). */
    memoryRssMb: z.number().nonnegative(),
  })
  .strict();

/** Inferred type for {@link ProcessHealthSnapshotSchema}. */
export type ProcessHealthSnapshot = z.infer<typeof ProcessHealthSnapshotSchema>;

/**
 * Full health report returned by `GET /health`.
 *
 * @example
 * ```ts
 * const report: HealthReport = {
 *   status: 'ok',
 *   service: 'orbit-ctrl-api',
 *   version: '0.1.0',
 *   timestamp: '2026-05-12T14:31:09.000Z',
 *   process: { uptimeSeconds: 42.1, pid: 12345, memoryRssMb: 87.3 },
 * };
 * ```
 */
export const HealthReportSchema = z
  .object({
    /** Always `"ok"` while the service is up. Reserved for future degraded states. */
    status: z.enum(['ok', 'degraded']),
    /** Service identifier, useful when multiple APIs are deployed under one gateway. */
    service: z.string().min(1),
    /** Semver of `@orbit-ctrl/api` at build time. */
    version: z.string().min(1),
    /** ISO 8601 timestamp at the moment the report was generated. */
    timestamp: z.string().datetime(),
    /** Process-level facts. */
    process: ProcessHealthSnapshotSchema,
  })
  .strict();

/** Inferred type for {@link HealthReportSchema}. */
export type HealthReport = z.infer<typeof HealthReportSchema>;
