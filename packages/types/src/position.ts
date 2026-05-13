/**
 * Geodetic position of a propagated satellite at a single instant.
 *
 * @packageDocumentation
 */
import { z } from 'zod';

/**
 * Instantaneous geodetic position of a satellite over Earth.
 *
 * Computed by propagating a `Satellite`'s TLE forward to `timestamp` using
 * SGP4, then converting ECI → ECEF → geodetic coordinates.
 *
 * Units: kilometers for distances, km/s for velocity, degrees for angles.
 *
 * @example
 * ```ts
 * // ISS over Tokyo at altitude ~420 km
 * const pos: Position = {
 *   lat: 35.68,
 *   lon: 139.69,
 *   alt: 419.7,
 *   velocity: 7.66,
 *   timestamp: '2026-05-12T14:31:09.000Z',
 * };
 * ```
 */
export const PositionSchema = z
  .object({
    /** Geodetic latitude in degrees, [-90, 90]. Positive north. */
    lat: z.number().min(-90).max(90),
    /** Geodetic longitude in degrees, [-180, 180]. Positive east. */
    lon: z.number().min(-180).max(180),
    /** Altitude above WGS-84 ellipsoid in kilometers. */
    alt: z.number(),
    /** Magnitude of velocity vector in km/s. */
    velocity: z.number().nonnegative(),
    /** ISO 8601 timestamp at which this position was computed. */
    timestamp: z.string().datetime(),
  })
  .strict();

/** Inferred type for {@link PositionSchema}. */
export type Position = z.infer<typeof PositionSchema>;
