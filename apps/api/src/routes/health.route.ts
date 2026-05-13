/**
 * Health route — Fastify plugin binding `GET /health` to the health
 * controller. Routes are pure URL → handler wiring + schema only; no logic
 * lives here.
 *
 * Response validation/serialization is driven by the shared
 * {@link HealthReportSchema} from `@orbit-ctrl/types` via
 * `fastify-type-provider-zod`. There is no hand-written JSON Schema in this
 * file — one schema, one source of truth.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { HealthReportSchema } from '@orbit-ctrl/types';
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
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        response: {
          200: HealthReportSchema,
        },
      },
    },
    opts.controller.getHealth,
  );
};
