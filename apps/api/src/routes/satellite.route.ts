/**
 * Satellite routes — Fastify plugin binding the satellite HTTP surface.
 *
 * Routes are pure URL → controller wiring with Zod schemas. The schemas
 * come from `@orbit-ctrl/types` (shared with the frontend) where possible;
 * path/query schemas that are route-local stay inline.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { GroundTrackSchema, PositionSchema, SatelliteSchema } from '@orbit-ctrl/types';
import type { SatelliteController } from '../controllers/satellite.controller.js';

export interface SatelliteRouteOptions {
  controller: SatelliteController;
}

/** `:id` path parameter — accepts any positive integer NORAD catalogue number. */
const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Optional `?time=<ISO>` query for time-travel propagation. */
const TimeQuerySchema = z.object({
  time: z.string().datetime().optional(),
});

/** `?periodMin=...` query — clamped to a sensible range so we don't propagate weeks ahead. */
const TrackQuerySchema = z.object({
  periodMin: z.coerce.number().positive().max(720).optional(),
});

/**
 * Register `/satellites/*` on the given Fastify instance.
 *
 * @example
 * ```ts
 * await server.register(satelliteRoute, { controller: satelliteController });
 * ```
 */
export const satelliteRoute: FastifyPluginAsync<SatelliteRouteOptions> = async (
  fastify: FastifyInstance,
  opts: SatelliteRouteOptions,
) => {
  const f = fastify.withTypeProvider<ZodTypeProvider>();

  f.get(
    '/satellites',
    {
      schema: { response: { 200: z.array(SatelliteSchema) } },
    },
    opts.controller.list,
  );

  f.get(
    '/satellites/positions',
    {
      schema: {
        querystring: TimeQuerySchema,
        response: { 200: z.array(PositionSchema) },
      },
    },
    opts.controller.listPositions,
  );

  f.get(
    '/satellites/:id/position',
    {
      schema: {
        params: IdParamSchema,
        querystring: TimeQuerySchema,
        response: { 200: PositionSchema },
      },
    },
    opts.controller.getPosition,
  );

  f.get(
    '/satellites/:id/track',
    {
      schema: {
        params: IdParamSchema,
        querystring: TrackQuerySchema,
        response: { 200: GroundTrackSchema },
      },
    },
    opts.controller.getGroundTrack,
  );
};
