/**
 * useGroundTrack — fetch a single satellite's forward trajectory.
 *
 * Disabled when `noradId` is `null` so it can be called unconditionally from
 * a "selected satellite" panel. Refetches every 5 minutes to keep the path
 * roughly synchronised with the live positions.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GroundTrack } from '@orbit-ctrl/types';
import { fetchGroundTrack } from '../api/satellites';

/** Stale-after window for cached ground tracks (5 minutes). */
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Subscribe to the ground track of one satellite. Pass `null` to disable.
 *
 * @example
 * ```tsx
 * const { data: track } = useGroundTrack(selectedId);
 * return <Globe pathsData={track ? [track] : []} />;
 * ```
 */
export function useGroundTrack(
  noradId: number | null,
  periodMin?: number,
): UseQueryResult<GroundTrack> {
  return useQuery({
    queryKey: ['satellites', noradId, 'track', periodMin ?? 'default'],
    queryFn: () => fetchGroundTrack(noradId as number, periodMin),
    enabled: noradId !== null,
    staleTime: STALE_TIME_MS,
    refetchInterval: STALE_TIME_MS,
  });
}
