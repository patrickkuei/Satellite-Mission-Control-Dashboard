/**
 * Observer / ground-station location contract used by pass prediction and
 * "satellites above" queries.
 *
 * @packageDocumentation
 */
import { z } from 'zod';

/**
 * Geographic observer location. Defaults to Tokyo (35.68° N, 139.69° E) in the
 * demo when the user hasn't shared location.
 */
export const ObserverLocationSchema = z
  .object({
    /** Geodetic latitude in degrees, [-90, 90]. */
    lat: z.number().min(-90).max(90),
    /** Geodetic longitude in degrees, [-180, 180]. */
    lon: z.number().min(-180).max(180),
    /** Optional altitude above WGS-84 ellipsoid in meters (defaults to 0). */
    altMeters: z.number().optional(),
  })
  .strict();

/** Inferred type for {@link ObserverLocationSchema}. */
export type ObserverLocation = z.infer<typeof ObserverLocationSchema>;
