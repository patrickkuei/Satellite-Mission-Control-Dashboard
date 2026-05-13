/**
 * Health controller — HTTP adapter for the {@link HealthService}.
 *
 * Controllers translate between Fastify (req/reply) and the service layer.
 * Keep this layer thin: parse + validate input, call the service, format the
 * output. No business logic, no direct repository/client calls.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { HealthReport } from '@orbit-ctrl/types';
import type { HealthService } from '../services/health.service.js';

/** Public surface of the health controller. */
export interface HealthController {
  /** Handle `GET /health`. */
  getHealth(req: FastifyRequest, reply: FastifyReply): Promise<HealthReport>;
}

/**
 * Build a {@link HealthController} bound to a service instance.
 *
 * @example
 * ```ts
 * const controller = createHealthController(healthService);
 * fastify.get('/health', controller.getHealth);
 * ```
 */
export function createHealthController(service: HealthService): HealthController {
  return {
    async getHealth(_req, reply) {
      const report = service.getReport();
      reply.type('application/json');
      return report;
    },
  };
}
