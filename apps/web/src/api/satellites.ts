/**
 * Thin fetch wrappers for the `/satellites/*` REST surface. Hooks under
 * `src/hooks/` are the only callers — components never touch `fetch` directly.
 *
 * Shapes are imported from `@orbit-ctrl/types`, the single source of truth
 * shared with the backend.
 */
import type { GroundTrack, ObserverLocation, Pass, Position, Satellite } from '@orbit-ctrl/types';
import { apiBase } from './config';

/** Result of {@link fetchSatellites}, tagged to indicate data origin. */
export interface SatellitesResult {
  satellites: Satellite[];
  /** True when data comes from the static GH Pages snapshot (API unreachable). */
  stale: boolean;
  /** ISO 8601 timestamp of the snapshot; only set when `stale` is true. */
  fetchedAt?: string;
}

/**
 * Fetch the curated satellite list from the API. On any failure, falls back
 * to the static snapshot served from GitHub Pages (`/satellites-snapshot.json`)
 * so the globe renders even while the Render server is waking up.
 *
 * @throws Only if both the API and the static snapshot are unreachable.
 */
export async function fetchSatellites(): Promise<SatellitesResult> {
  try {
    // 8 s timeout — fast enough to show snapshot before a Render cold-start
    // hangs, long enough to survive a slow but responsive server.
    const res = await fetch(`${apiBase}/satellites`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`${res.status}`);
    const satellites = (await res.json()) as Satellite[];
    return { satellites, stale: false };
  } catch {
    const snap = await fetch(`${import.meta.env.BASE_URL}satellites-snapshot.json`);
    if (!snap.ok) throw new Error('Satellite data unavailable: API and snapshot both unreachable');
    const payload = (await snap.json()) as { fetchedAt: string; satellites: Satellite[] };
    return { satellites: payload.satellites, stale: true, fetchedAt: payload.fetchedAt };
  }
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
