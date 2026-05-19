/**
 * Client-side SGP4 position computation — mirrors the server-side propagate()
 * in apps/api/src/services/orbit.service.ts. Used as a fallback when the API
 * server is unreachable and satellites are loaded from the static snapshot.
 */
import * as satellite from 'satellite.js';
import type { Position, Satellite } from '@orbit-ctrl/types';

/**
 * Compute the geodetic position of a satellite at the given time using SGP4.
 * Returns `null` if propagation fails (decayed orbit, bad TLE, etc.).
 *
 * @param sat  - Satellite with a valid two-line element set.
 * @param time - Time to propagate to. Defaults to now.
 */
export function propagatePosition(sat: Satellite, time: Date = new Date()): Position | null {
  try {
    const satrec = satellite.twoline2satrec(sat.tle.line1, sat.tle.line2);
    const pv = satellite.propagate(satrec, time);
    if (!pv.position || typeof pv.position === 'boolean') return null;

    const gmst = satellite.gstime(time);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    const v = pv.velocity;
    const velocity =
      !v || typeof v === 'boolean' ? 0 : Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

    return {
      lat: satellite.degreesLat(geo.latitude),
      lon: satellite.degreesLong(geo.longitude),
      alt: geo.height,
      velocity,
      timestamp: time.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Compute positions for every satellite in the list at the given time.
 * Satellites whose propagation fails are excluded from the result.
 *
 * @param satellites - List of satellites with TLE data.
 * @param time       - Defaults to now.
 */
export function propagateAll(satellites: Satellite[], time: Date = new Date()): Position[] {
  return satellites.flatMap((sat) => {
    const pos = propagatePosition(sat, time);
    return pos ? [pos] : [];
  });
}
