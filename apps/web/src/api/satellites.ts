/**
 * Thin fetch wrappers for the `/satellites/*` REST surface. Hooks under
 * `src/hooks/` are the only callers — components never touch `fetch` directly.
 *
 * Shapes are imported from `@orbit-ctrl/types`, the single source of truth
 * shared with the backend.
 */
import type { GroundTrack, ObserverLocation, Pass, Position, Satellite } from '@orbit-ctrl/types';
import { apiBase } from './config';

/** Fetch the curated list of tracked satellites (one-time on app boot). */
export async function fetchSatellites(): Promise<Satellite[]> {
  const res = await fetch(`${apiBase}/satellites`);
  if (!res.ok) throw new Error(`GET ${apiBase}/satellites failed: ${res.status}`);
  return (await res.json()) as Satellite[];
}

/**
 * Fetch current positions of every tracked satellite in a single round-trip.
 * Used by the globe at 1 Hz; the bulk endpoint avoids N concurrent requests.
 *
 * @param time - Optional ISO 8601 timestamp; defaults to "now" on the server.
 */
export async function fetchSatellitePositions(time?: string): Promise<Position[]> {
  const url = time
    ? `${apiBase}/satellites/positions?time=${encodeURIComponent(time)}`
    : `${apiBase}/satellites/positions`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${apiBase}/satellites/positions failed: ${res.status}`);
  return (await res.json()) as Position[];
}

/** Fetch a single satellite's forward ground track. */
export async function fetchGroundTrack(noradId: number, periodMin?: number): Promise<GroundTrack> {
  const qs = periodMin !== undefined ? `?periodMin=${periodMin}` : '';
  const res = await fetch(`${apiBase}/satellites/${noradId}/track${qs}`);
  if (!res.ok) throw new Error(`GET ${apiBase}/satellites/${noradId}/track failed: ${res.status}`);
  return (await res.json()) as GroundTrack;
}

/**
 * Fetch the predicted passes of one satellite over a ground observer.
 *
 * @param noradId  - NORAD ID from the curated set.
 * @param observer - Observer location (lat/lon degrees, optional altMeters).
 * @param hours    - Forward window in hours. Backend caps at 72.
 */
export async function fetchPasses(
  noradId: number,
  observer: ObserverLocation,
  hours: number,
): Promise<Pass[]> {
  const params = new URLSearchParams({
    lat: String(observer.lat),
    lon: String(observer.lon),
    hours: String(hours),
  });
  if (observer.altMeters !== undefined) params.set('altMeters', String(observer.altMeters));
  const res = await fetch(`${apiBase}/satellites/${noradId}/passes?${params.toString()}`);
  if (!res.ok) throw new Error(`GET ${apiBase}/satellites/${noradId}/passes failed: ${res.status}`);
  return (await res.json()) as Pass[];
}
