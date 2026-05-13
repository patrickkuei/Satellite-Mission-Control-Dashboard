/**
 * useSatellites — fetch the curated satellite list once via TanStack Query.
 *
 * The list is effectively static for a session (Celestrak refreshes once per
 * day on the backend), so no polling — we just rely on the query cache.
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
  });
}
