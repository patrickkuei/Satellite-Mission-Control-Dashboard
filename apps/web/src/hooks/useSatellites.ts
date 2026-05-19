/**
 * useSatellites — fetch the curated satellite list once via TanStack Query.
 *
 * The list is effectively static for a session (Celestrak refreshes once per
 * day on the backend), so no polling — we just rely on the query cache.
 *
 * Retry policy: 8 attempts with exponential backoff (capped at 10 s each).
 * Total window ≈ 55 s — enough to outlast a Render free-tier cold start
 * (~30–50 s) before the query transitions to `isError`.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Satellite } from '@orbit-ctrl/types';
import { fetchSatellites } from '../api/satellites';

/** Query-key constant so other hooks / devtools can target the cache entry. */
export const SATELLITES_QUERY_KEY = ['satellites'] as const;

/**
 * Subscribe to the tracked satellite list.
 *
 * @example
 * ```tsx
 * const { data: satellites = [] } = useSatellites();
 * return <span>Tracking {satellites.length} satellites</span>;
 * ```
 */
export function useSatellites(): UseQueryResult<Satellite[]> {
  return useQuery({
    queryKey: SATELLITES_QUERY_KEY,
    queryFn: fetchSatellites,
    staleTime: Infinity,
    retry: 8,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
}
