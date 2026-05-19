/**
 * useSatellites — fetch the curated satellite list once via TanStack Query.
 *
 * Retries up to 8× with exponential backoff (capped at 10 s) to outlast a
 * Render free-tier cold start. On persistent failure the query enters isError
 * state and the App renders the wakeup banner with a manual retry button.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Satellite } from '@orbit-ctrl/types';
import { fetchSatellites, type SatellitesResult } from '../api/satellites';

/** Query-key constant so other hooks / devtools can target the cache entry. */
export const SATELLITES_QUERY_KEY = ['satellites'] as const;

/**
 * Subscribe to the tracked satellite list. Returns the full {@link SatellitesResult}
 * so callers can distinguish live API data from the static GH Pages snapshot.
 *
 * @example
 * ```tsx
 * const { data } = useSatellites();
 * const satellites = data?.satellites ?? [];
 * const isStale = data?.stale ?? false;
 * ```
 */
export function useSatellites(): UseQueryResult<SatellitesResult> {
  return useQuery({
    queryKey: SATELLITES_QUERY_KEY,
    queryFn: fetchSatellites,
    staleTime: Infinity,
    retry: 8,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
}
