/**
 * Space-weather contracts sourced from NOAA SWPC. Refreshed every 15 minutes.
 *
 * @packageDocumentation
 */
import { z } from 'zod';

/** Solar wind plasma parameters measured at L1 by DSCOVR / ACE. */
export const SolarWindSchema = z
  .object({
    /** Bulk speed in km/s. Quiet ≈ 350, fast streams ≈ 700+. */
    speedKmS: z.number().nonnegative(),
    /** Proton number density in particles per cubic centimeter. */
    densityProtonsCm3: z.number().nonnegative(),
    /**
     * Z-component of interplanetary magnetic field in nanotesla.
     * Sustained negative Bz drives geomagnetic storms.
     */
    bzNanoTesla: z.number(),
  })
  .strict();

/** Inferred type for {@link SolarWindSchema}. */
export type SolarWind = z.infer<typeof SolarWindSchema>;

/**
 * GOES X-ray flux observation in the standard solar flare letter-class scale.
 *
 * - `A`: 1e-8 W/m² (quiet)
 * - `B`: 1e-7 W/m²
 * - `C`: 1e-6 W/m²
 * - `M`: 1e-5 W/m² (medium flare — can disrupt HF radio)
 * - `X`: 1e-4 W/m² (major flare — radiation storm risk)
 */
export const XRayFluxSchema = z
  .object({
    class: z.enum(['A', 'B', 'C', 'M', 'X']),
    /** Mantissa within the class band, e.g., M2.4 → magnitude 2.4. */
    magnitude: z.number().positive(),
  })
  .strict();

/** Inferred type for {@link XRayFluxSchema}. */
export type XRayFlux = z.infer<typeof XRayFluxSchema>;

/** Coarse space-weather summary used for UI badges and agent narration. */
export const WeatherSummarySchema = z.enum(['quiet', 'unsettled', 'active', 'storm']);
/** Inferred type for {@link WeatherSummarySchema}. */
export type WeatherSummary = z.infer<typeof WeatherSummarySchema>;

/**
 * Current space weather snapshot from NOAA SWPC.
 *
 * @example
 * ```ts
 * const weather: SpaceWeather = {
 *   kpIndex: 3.1,
 *   solarWind: { speedKmS: 412, densityProtonsCm3: 8.4, bzNanoTesla: -2.1 },
 *   xrayFlux: { class: 'C', magnitude: 2.4 },
 *   summary: 'quiet',
 *   fetchedAt: '2026-05-12T14:31:09.000Z',
 * };
 * ```
 */
export const SpaceWeatherSchema = z
  .object({
    /**
     * Planetary K-index, 0–9. Logarithmic scale of geomagnetic disturbance.
     * Values ≥ 5 indicate a geomagnetic storm.
     */
    kpIndex: z.number().min(0).max(9),
    /** Real-time solar wind parameters from L1. */
    solarWind: SolarWindSchema,
    /** GOES X-ray flux from the active solar X-ray sensor. */
    xrayFlux: XRayFluxSchema,
    /** Coarse summary used for UI badges + agent responses. */
    summary: WeatherSummarySchema,
    /** ISO 8601 timestamp this snapshot was retrieved from NOAA. */
    fetchedAt: z.string().datetime(),
  })
  .strict();

/** Inferred type for {@link SpaceWeatherSchema}. */
export type SpaceWeather = z.infer<typeof SpaceWeatherSchema>;
