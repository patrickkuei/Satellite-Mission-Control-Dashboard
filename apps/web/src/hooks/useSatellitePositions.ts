/**
 * useSatellitePositions — poll the bulk positions endpoint at a fixed cadence.
 *
 * Backed by TanStack Query with `refetchInterval`; the hook returns the
 * latest array so the globe re-renders smoothly. Pausing the tab pauses
 * polling automatically (TanStack Query default).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Position } from '@orbit-ctrl/types';
import { fetchSatellitePositions } from '../api/satellites';

/** Default poll interval — once per second matches the 1 Hz design target. */
const DEFAULT_POLL_MS = 1000;

/**
 * Subscribe to live positions for every tracked satellite.
 *
 * @param pollMs - Override poll interval. Defaults to 1000 ms.
 *
 * @example
 * ```tsx
 * const { data: positions = [] } = useSatellitePositions();
 * return <Globe objectsData={positions} />;
 * ```
 */
/**
 * @param pollMs - Poll interval in ms. Pass `0` to pause polling (e.g. when
 *                 server is down and positions are computed client-side).
 */
export function useSatellitePositions(
  pollMs: number = DEFAULT_POLL_MS,
): UseQueryResult<Position[]> {
  return useQuery({
    queryKey: ['satellites', 'positions'],
    queryFn: () => fetchSatellitePositions(),
    // false disables polling; TanStack Query treats 0 as false for refetchInterval.
    refetchInterval: pollMs > 0 ? pollMs : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
    enabled: pollMs > 0,
  });
}
