/**
 * Satellite + TLE contracts.
 *
 * Schemas describe the **wire shape** (what crosses the network). All
 * timestamps are ISO 8601 strings; consumers convert to `Date` at the edge.
 *
 * @packageDocumentation
 */
import { z } from 'zod';

/**
 * Two-line element set — the standard format for satellite orbital elements.
 *
 * See {@link https://en.wikipedia.org/wiki/Two-line_element_set} for the
 * column-level spec. Lines must be passed verbatim to `satellite.js` without
 * trimming or normalization.
 */
export const TLESchema = z
  .object({
    /** Line 1 of the TLE (69 characters; includes drag terms + epoch). */
    line1: z.string().length(69),
    /** Line 2 of the TLE (69 characters; includes orbital elements). */
    line2: z.string().length(69),
    /** ISO 8601 epoch parsed from the TLE for cache invalidation. */
    epoch: z.string().datetime(),
  })
  .strict();

/** Inferred type for {@link TLESchema}. */
export type TLE = z.infer<typeof TLESchema>;

/**
 * A satellite tracked by the system. Backed by a {@link TLE} fetched from
 * Celestrak and refreshed every 24 hours.
 *
 * @example
 * ```ts
 * const iss: Satellite = {
 *   noradId: 25544,
 *   name: 'ISS (ZARYA)',
 *   tle: {
 *     line1: '1 25544U 98067A   24320.50000000  .00012345  00000-0  22345-3 0  9991',
 *     line2: '2 25544  51.6400 123.4567 0001234  12.3456 347.6543 15.50123456 12345',
 *     epoch: '2024-11-15T12:00:00.000Z',
 *   },
 * };
 * ```
 */
export const SatelliteSchema = z
  .object({
    /** NORAD catalog number — unique integer ID assigned by US Space Command. */
    noradId: z.number().int().positive(),
    /** Human-readable name as published by Celestrak (e.g., "ISS (ZARYA)"). */
    name: z.string().min(1),
    /** Two-line element set used by SGP4 propagation. */
    tle: TLESchema,
  })
  .strict();

/** Inferred type for {@link SatelliteSchema}. */
export type Satellite = z.infer<typeof SatelliteSchema>;
