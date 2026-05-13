/**
 * Health route — Fastify plugin binding `GET /health` to the health
 * controller. Routes are pure URL → handler wiring + schema; no logic lives
 * here.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { HealthController } from '../controllers/health.controller.js';

export interface HealthRouteOptions {
  controller: HealthController;
}

/**
 * Register the `/health` route on the given Fastify instance.
 *
 * @example
 * ```ts
 * await server.register(healthRoute, { controller: healthController });
 * ```
 */
export const healthRoute: FastifyPluginAsync<HealthRouteOptions> = async (
  fastify: FastifyInstance,
  opts: HealthRouteOptions,
) => {
  fastify.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['status', 'service', 'version', 'timestamp', 'process'],
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded'] },
              service: { type: 'string' },
              version: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              process: {
                type: 'object',
                required: ['uptimeSeconds', 'pid', 'memoryRssMb'],
                properties: {
                  uptimeSeconds: { type: 'number' },
                  pid: { type: 'integer' },
                  memoryRssMb: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    opts.controller.getHealth,
  );
};
