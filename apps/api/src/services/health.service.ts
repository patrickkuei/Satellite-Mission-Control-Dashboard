/**
 * Health service — business logic for the liveness probe. Composes the
 * health repository with static service metadata (name, version) so the HTTP
 * layer can return a complete payload without knowing about `process` or
 * `package.json`.
 *
 * This is the canonical "service" reference for the codebase: pure logic,
 * HTTP-agnostic, dependencies injected via the factory.
 */
import type { HealthRepository } from '../repositories/health.repository.js';

/** Full health report returned to the client. */
export interface HealthReport {
  /** Always `"ok"` while the service is up. Reserved for future degraded states. */
  status: 'ok' | 'degraded';
  /** Service identifier, useful when multiple APIs are deployed under one gateway. */
  service: string;
  /** Semver of `@orbit-ctrl/api` at build time. */
  version: string;
  /** ISO 8601 timestamp at the moment the report was generated. */
  timestamp: string;
  /** Process-level facts from the {@link HealthRepository}. */
  process: {
    uptimeSeconds: number;
    pid: number;
    memoryRssMb: number;
  };
}

/** Public surface of the health service. */
export interface HealthService {
  /** Build a complete health report. Pure function — no side effects. */
  getReport(): HealthReport;
}

/** Static metadata injected into every health report. */
export interface HealthServiceDeps {
  repository: HealthRepository;
  serviceName: string;
  version: string;
}

/**
 * Construct a {@link HealthService} with explicit dependencies. Prefer this
 * factory over a class so tests can inject mocks for `repository` and pass a
 * deterministic `version`.
 *
 * @example
 * ```ts
 * const service = createHealthService({
 *   repository: createHealthRepository(),
 *   serviceName: 'orbit-ctrl-api',
 *   version: '0.1.0',
 * });
 * const report = service.getReport();
 * ```
 */
export function createHealthService(deps: HealthServiceDeps): HealthService {
  return {
    getReport() {
      return {
        status: 'ok',
        service: deps.serviceName,
        version: deps.version,
        timestamp: new Date().toISOString(),
        process: deps.repository.getProcessSnapshot(),
      };
    },
  };
}
