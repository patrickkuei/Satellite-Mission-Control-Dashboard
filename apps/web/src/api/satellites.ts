/**
 * Thin fetch wrappers for the `/satellites/*` REST surface. Hooks under
 * `src/hooks/` are the only callers — components never touch `fetch` directly.
 *
 * Shapes are imported from `@orbit-ctrl/types`, the single source of truth
 * shared with the backend.
 */
import type { GroundTrack, Position, Satellite } from '@orbit-ctrl/types';

/** Fetch the curated list of tracked satellites (one-time on app boot). */
export async function fetchSatellites(): Promise<Satellite[]> {
  const res = await fetch('/api/satellites');
  if (!res.ok) throw new Error(`GET /api/satellites failed: ${res.status}`);
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
    ? `/api/satellites/positions?time=${encodeURIComponent(time)}`
    : '/api/satellites/positions';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET /api/satellites/positions failed: ${res.status}`);
  return (await res.json()) as Position[];
}

/** Fetch a single satellite's forward ground track. */
export async function fetchGroundTrack(noradId: number, periodMin?: number): Promise<GroundTrack> {
  const qs = periodMin !== undefined ? `?periodMin=${periodMin}` : '';
  const res = await fetch(`/api/satellites/${noradId}/track${qs}`);
  if (!res.ok) throw new Error(`GET /api/satellites/${noradId}/track failed: ${res.status}`);
  return (await res.json()) as GroundTrack;
}
