/**
 * Orbit service — pure orbital-mechanics layer.
 *
 * Wraps `satellite.js` (SGP4) so the rest of the codebase never imports it
 * directly. Three responsibilities:
 *   1. Propagate a single satellite to an instant in time → {@link Position}.
 *   2. Sample a future trajectory at fixed intervals → {@link GroundTrack}.
 *   3. Predict ground-observer visibility windows → {@link Pass}[].
 *
 * The service is stateless and HTTP-agnostic; unit tests instantiate it
 * directly and feed real TLEs (no network).
 */
import * as satellite from 'satellite.js';
import type { GroundTrack, ObserverLocation, Pass, Position, Satellite } from '@orbit-ctrl/types';

/** Default sampling step for ground tracks. 30 s ≈ 200 km of LEO travel. */
const GROUND_TRACK_STEP_SECONDS = 30;
/** Default forward window for ground tracks. ~1 LEO orbit. */
export const DEFAULT_GROUND_TRACK_MINUTES = 90;
/** Pass-prediction step. 60 s is the textbook compromise between accuracy and runtime. */
const PASS_STEP_SECONDS = 60;
/** Hard cap on the pass-prediction window. Stops runaway queries (and bad TLEs). */
export const PASS_MAX_HOURS = 72;

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
  /**
   * Predict visible passes of a satellite over a ground observer.
   *
   * Steps SGP4 forward at {@link PASS_STEP_SECONDS}, records contiguous windows
   * where the topocentric elevation rises above 0°, and reports start/end +
   * peak. The 60 s step under-resolves brief LEO passes by up to a minute on
   * each edge; good enough for a UI hint, not for pointing a dish.
   *
   * @param sat      - Satellite to track.
   * @param observer - Ground observer (lat/lon in degrees, optional altitude).
   * @param from     - Start of the prediction window.
   * @param hours    - Length of the window. Clamped to {@link PASS_MAX_HOURS}.
   * @returns Passes in chronological order. Empty array if none.
   * @throws If SGP4 propagation fails at any sample point.
   */
  predictPasses(sat: Satellite, observer: ObserverLocation, from: Date, hours: number): Pass[];
  /**
   * Topocentric look angles of `sat` from `observer` at `time`. Returns
   * `null` if SGP4 fails at that instant.
   *
   * @param sat      - Satellite to look at.
   * @param observer - Ground observer (lat/lon in degrees, optional altitude).
   * @param time     - Instant to evaluate.
   * @returns `{ elevationDeg, azimuthDeg, rangeKm }` or `null` on propagation failure.
   */
  lookAnglesAt(
    sat: Satellite,
    observer: ObserverLocation,
    time: Date,
  ): { elevationDeg: number; azimuthDeg: number; rangeKm: number } | null;
}

/**
 * Build a stateless {@link OrbitService}.
 *
 * @example
 * ```ts
 * const orbit = createOrbitService();
 * const pos = orbit.positionAt(iss, new Date());
 * // pos.lat, pos.lon, pos.alt (km), pos.velocity (km/s)
 *
 * const passes = orbit.predictPasses(iss, { lat: 35.68, lon: 139.69 }, new Date(), 24);
 * // passes[0].startTime, .endTime, .maxElevationDeg
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
    predictPasses(sat, observer, from, hours) {
      const windowHours = Math.min(Math.max(hours, 0), PASS_MAX_HOURS);
      return findPasses(sat, observer, from, windowHours);
    },
    lookAnglesAt(sat, observer, time) {
      return lookAngles(sat, observer, time);
    },
  };
}

/**
 * Full topocentric look angles (elevation + azimuth + range). Used by tools
 * that need azimuth as well as elevation; the internal {@link elevationDeg}
 * helper throws away the rest of the look-angle struct for pass scanning.
 */
function lookAngles(
  sat: Satellite,
  observer: ObserverLocation,
  time: Date,
): { elevationDeg: number; azimuthDeg: number; rangeKm: number } | null {
  const satrec = satellite.twoline2satrec(sat.tle.line1, sat.tle.line2);
  const pv = satellite.propagate(satrec, time);
  if (!pv.position || typeof pv.position === 'boolean') return null;

  const gmst = satellite.gstime(time);
  const observerGd = {
    latitude: (observer.lat * Math.PI) / 180,
    longitude: (observer.lon * Math.PI) / 180,
    height: (observer.altMeters ?? 0) / 1000,
  };
  const positionEcf = satellite.eciToEcf(pv.position, gmst);
  const look = satellite.ecfToLookAngles(observerGd, positionEcf);
  return {
    elevationDeg: (look.elevation * 180) / Math.PI,
    azimuthDeg: (look.azimuth * 180) / Math.PI,
    rangeKm: look.rangeSat,
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

/**
 * Topocentric elevation of `sat` from `observer` at `time`, in degrees.
 *
 * Returns `-Infinity` if SGP4 fails — the caller treats that as "below
 * horizon" so a single bad sample doesn't abort the entire scan.
 */
function elevationDeg(sat: Satellite, observer: ObserverLocation, time: Date): number {
  const satrec = satellite.twoline2satrec(sat.tle.line1, sat.tle.line2);
  const pv = satellite.propagate(satrec, time);
  if (!pv.position || typeof pv.position === 'boolean') return -Infinity;

  const gmst = satellite.gstime(time);
  const observerGd = {
    latitude: (observer.lat * Math.PI) / 180,
    longitude: (observer.lon * Math.PI) / 180,
    height: (observer.altMeters ?? 0) / 1000, // satellite.js wants km
  };
  const positionEcf = satellite.eciToEcf(pv.position, gmst);
  const look = satellite.ecfToLookAngles(observerGd, positionEcf);
  return (look.elevation * 180) / Math.PI;
}

/**
 * Walk a fixed-step time grid, opening a pass at the first sample with
 * elevation > 0 and closing it at the first sample below. The peak is the
 * maximum observed across the open window.
 *
 * Split into a helper so {@link createOrbitService} stays under the cognitive
 * complexity threshold enforced by ESLint.
 */
function findPasses(sat: Satellite, observer: ObserverLocation, from: Date, hours: number): Pass[] {
  const passes: Pass[] = [];
  const totalSamples = Math.ceil((hours * 3600) / PASS_STEP_SECONDS);
  let open: OpenPass | null = null;

  for (let i = 0; i <= totalSamples; i++) {
    const t = new Date(from.getTime() + i * PASS_STEP_SECONDS * 1000);
    const el = elevationDeg(sat, observer, t);

    if (el > 0) {
      open = extendPass(open, t, el);
    } else if (open) {
      passes.push(closePass(open, t, sat.noradId));
      open = null;
    }
  }

  if (open) {
    // Pass was still above horizon at the window edge — close it at the last
    // sample we have, even though the satellite hasn't actually set yet.
    const tail = new Date(from.getTime() + totalSamples * PASS_STEP_SECONDS * 1000);
    passes.push(closePass(open, tail, sat.noradId));
  }
  return passes;
}

/** Mutable in-progress pass — never escapes this module. */
interface OpenPass {
  start: Date;
  maxElevationDeg: number;
  maxElevationAt: Date;
}

function extendPass(open: OpenPass | null, t: Date, el: number): OpenPass {
  if (!open) return { start: t, maxElevationDeg: el, maxElevationAt: t };
  if (el > open.maxElevationDeg) {
    return { start: open.start, maxElevationDeg: el, maxElevationAt: t };
  }
  return open;
}

function closePass(open: OpenPass, end: Date, satelliteId: number): Pass {
  return {
    satelliteId,
    startTime: open.start.toISOString(),
    endTime: end.toISOString(),
    maxElevationDeg: Math.min(open.maxElevationDeg, 90),
    maxElevationAt: open.maxElevationAt.toISOString(),
    durationSeconds: Math.max(1, Math.round((end.getTime() - open.start.getTime()) / 1000)),
  };
}
