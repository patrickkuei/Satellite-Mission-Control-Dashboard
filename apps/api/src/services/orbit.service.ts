/**
 * Orbit service — pure orbital-mechanics layer.
 *
 * Wraps `satellite.js` (SGP4) so the rest of the codebase never imports it
 * directly. Two responsibilities:
 *   1. Propagate a single satellite to an instant in time → {@link Position}.
 *   2. Sample a future trajectory at fixed intervals → {@link GroundTrack}.
 *
 * The service is stateless and HTTP-agnostic; unit tests instantiate it
 * directly and feed real TLEs (no network).
 */
import * as satellite from 'satellite.js';
import type { GroundTrack, Position, Satellite } from '@orbit-ctrl/types';

/** Default sampling step for ground tracks. 30 s ≈ 200 km of LEO travel. */
const GROUND_TRACK_STEP_SECONDS = 30;
/** Default forward window for ground tracks. ~1 LEO orbit. */
export const DEFAULT_GROUND_TRACK_MINUTES = 90;

/** Public surface of the orbit service. */
export interface OrbitService {
  /**
   * Compute the geodetic position of a satellite at a given instant.
   *
   * @param sat  - Satellite with a valid TLE.
   * @param time - Instant to propagate to.
   * @returns The {@link Position} at `time`.
   * @throws If SGP4 propagation fails (TLE decayed, epoch too far in the past).
   */
  positionAt(sat: Satellite, time: Date): Position;
  /**
   * Sample a satellite's future trajectory at a fixed cadence.
   *
   * @param sat       - Satellite to propagate.
   * @param from      - Start of the window.
   * @param periodMin - Window length in minutes (default ~one LEO orbit).
   * @param stepSec   - Step size in seconds (default 30 s).
   * @returns A {@link GroundTrack} with `points.length === floor(periodMin*60/stepSec) + 1`.
   */
  groundTrack(sat: Satellite, from: Date, periodMin?: number, stepSec?: number): GroundTrack;
}

/**
 * Build a stateless {@link OrbitService}.
 *
 * @example
 * ```ts
 * const orbit = createOrbitService();
 * const pos = orbit.positionAt(iss, new Date());
 * // pos.lat, pos.lon, pos.alt (km), pos.velocity (km/s)
 * ```
 */
export function createOrbitService(): OrbitService {
  return {
    positionAt(sat, time) {
      return propagate(sat, time);
    },
    groundTrack(
      sat,
      from,
      periodMin = DEFAULT_GROUND_TRACK_MINUTES,
      stepSec = GROUND_TRACK_STEP_SECONDS,
    ) {
      const totalSec = periodMin * 60;
      const points: Position[] = [];
      for (let s = 0; s <= totalSec; s += stepSec) {
        const t = new Date(from.getTime() + s * 1000);
        points.push(propagate(sat, t));
      }
      return { satelliteId: sat.noradId, points };
    },
  };
}

/**
 * Run SGP4 propagation and convert the ECI result to geodetic coordinates.
 *
 * `satellite.js` returns `position`/`velocity` as `false` when SGP4 errors
 * out (most often because the TLE epoch is too stale or the satellite has
 * re-entered). We surface that as a thrown error rather than silently
 * returning bogus coordinates.
 */
function propagate(sat: Satellite, time: Date): Position {
  const satrec = satellite.twoline2satrec(sat.tle.line1, sat.tle.line2);
  const pv = satellite.propagate(satrec, time);
  if (!pv.position || typeof pv.position === 'boolean') {
    throw new Error(
      `SGP4 propagation failed for ${sat.name} (${sat.noradId}) at ${time.toISOString()}`,
    );
  }

  const gmst = satellite.gstime(time);
  const geodetic = satellite.eciToGeodetic(pv.position, gmst);
  const velocity = velocityMagnitude(pv.velocity);

  return {
    lat: satellite.degreesLat(geodetic.latitude),
    lon: satellite.degreesLong(geodetic.longitude),
    alt: geodetic.height,
    velocity,
    timestamp: time.toISOString(),
  };
}

/** Compute |v| from an ECI velocity vector, treating SGP4 failures as zero. */
function velocityMagnitude(v: satellite.EciVec3<number> | boolean): number {
  if (!v || typeof v === 'boolean') return 0;
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
