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
import { GroundTrackSchema, PassSchema, PositionSchema, SatelliteSchema } from '@orbit-ctrl/types';
import type { SatelliteController } from '../controllers/satellite.controller.js';

/** One satellite entry in the `/satellites/above` response. */
const VisibleSatelliteSchema = z.object({
  name: z.string(),
  noradId: z.number(),
  elevationDeg: z.number(),
  azimuthDeg: z.number(),
  rangeKm: z.number(),
});

/** Response shape for `GET /satellites/above`. */
const SatellitesAboveResponseSchema = z.object({
  totalVisible: z.number().int().nonnegative(),
  showing: z.number().int().nonnegative(),
  note: z.string().optional(),
  satellites: z.array(VisibleSatelliteSchema),
});

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

/** `?lat=&lon=&minElevationDeg=` query for the `/satellites/above` endpoint. */
const AboveQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  minElevationDeg: z.coerce.number().min(0).max(90).optional(),
});

/**
 * `?lat=...&lon=...&hours=...` query for pass prediction.
 *
 * `hours` is capped at 72 to match {@link PASS_MAX_HOURS} on the service.
 * `altMeters` defaults to sea-level if omitted.
 */
const PassesQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  hours: z.coerce.number().positive().max(72).optional(),
  altMeters: z.coerce.number().optional(),
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

  f.get(
    '/satellites/:id/passes',
    {
      schema: {
        params: IdParamSchema,
        querystring: PassesQuerySchema,
        response: { 200: z.array(PassSchema) },
      },
    },
    opts.controller.getPasses,
  );

  /**
   * `GET /satellites/above` — satellites currently above the horizon at `observer`.
   *
   * Returns the top 10 by elevation. Used by the MCP server's `find_satellites_above` tool.
   *
   * @example GET /satellites/above?lat=35.68&lon=139.69&minElevationDeg=10
   */
  f.get(
    '/satellites/above',
    {
      schema: {
        querystring: AboveQuerySchema,
        response: { 200: SatellitesAboveResponseSchema },
      },
    },
    opts.controller.getAbove,
  );
};
