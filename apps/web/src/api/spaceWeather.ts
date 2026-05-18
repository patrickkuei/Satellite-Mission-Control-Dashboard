/**
 * Thin fetch wrapper for `GET /space-weather`. Hooks under `src/hooks/` are
 * the only callers — components never touch `fetch` directly.
 */
import type { SpaceWeather } from '@orbit-ctrl/types';
import { apiBase } from './config';

/** Fetch the latest space-weather snapshot from the BFF. */
export async function fetchSpaceWeather(): Promise<SpaceWeather> {
  const res = await fetch(`${apiBase}/space-weather`);
  if (!res.ok) throw new Error(`GET /api/space-weather failed: ${res.status}`);
  return (await res.json()) as SpaceWeather;
}
