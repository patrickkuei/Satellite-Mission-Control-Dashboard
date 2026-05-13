/**
 * usePasses — predicted passes of one satellite over the user's observer
 * location, fetched via TanStack Query.
 *
 * The list is recomputed whenever satellite / location / window changes.
 * Refetch cadence is 5 minutes — passes only shift by a few seconds over that
 * window for LEO targets, and the SGP4 work is cheap on the backend so we
 * stay well under any rate limit.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ObserverLocation, Pass } from '@orbit-ctrl/types';
import { fetchPasses } from '../api/satellites';

/** Default look-ahead window in hours when the caller doesn't pass one. */
export const DEFAULT_PASS_HOURS = 24;
/** Re-poll cadence. Passes drift slowly enough that 5 min is plenty. */
const POLL_MS = 5 * 60 * 1000;

/**
 * Subscribe to the predicted passes of a satellite from a given observer
 * location.
 *
 * Returns an idle query when `noradId` is `null` (nothing selected) so the
 * hook can be unconditionally mounted.
 *
 * @example
 * ```tsx
 * const location = useObserverLocation((s) => s.location);
 * const { data: passes = [] } = usePasses(selectedId, location, 24);
 * ```
 */
export function usePasses(
  noradId: number | null,
  observer: ObserverLocation,
  hours: number = DEFAULT_PASS_HOURS,
): UseQueryResult<Pass[]> {
  return useQuery({
    queryKey: ['passes', noradId, observer.lat, observer.lon, observer.altMeters, hours],
    queryFn: () => fetchPasses(noradId as number, observer, hours),
    enabled: noradId !== null,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: POLL_MS,
  });
}
