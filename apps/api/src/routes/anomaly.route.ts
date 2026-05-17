/**
 * Anomaly route — `GET /anomalies`.
 *
 * Exposes the in-memory anomaly log as a REST endpoint for external consumers
 * (primarily the MCP server). The WebSocket `{type:'alert'}` stream is the
 * real-time path; this endpoint is for polling / one-shot queries.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AnomalySchema } from '@orbit-ctrl/types';
import type { AnomalyController } from '../controllers/anomaly.controller.js';

export interface AnomalyRouteOptions {
  controller: AnomalyController;
}

/**
 * Register `GET /anomalies` on the given Fastify instance.
 *
 * @example
 * ```ts
 * await server.register(anomalyRoute, { controller: anomalyController });
 * ```
 */
export const anomalyRoute: FastifyPluginAsync<AnomalyRouteOptions> = async (
  fastify: FastifyInstance,
  opts: AnomalyRouteOptions,
) => {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/anomalies',
    {
      schema: {
        querystring: z.object({
          /** Filter by satellite name (substring match) or NORAD ID. */
          name: z.string().optional(),
          /** Look-back window in minutes (default 30). */
          sinceMinutes: z.coerce.number().positive().max(1440).optional(),
        }),
        response: { 200: z.array(AnomalySchema) },
      },
    },
    opts.controller.getRecent,
  );
};
