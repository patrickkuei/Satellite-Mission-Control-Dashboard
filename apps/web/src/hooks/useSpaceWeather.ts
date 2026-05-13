/**
 * useSpaceWeather — subscribe to the latest NOAA SWPC snapshot.
 *
 * The backend caches snapshots for 15 minutes; we refetch every 5 minutes so
 * the badge picks up a new sample shortly after the cache rolls over. Stale
 * data is preferable to a flash of "loading" so we keep `placeholderData`.
 */
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SpaceWeather } from '@orbit-ctrl/types';
import { fetchSpaceWeather } from '../api/spaceWeather';

/** Query-key constant so other hooks / devtools can target the cache entry. */
export const SPACE_WEATHER_QUERY_KEY = ['space-weather'] as const;
/** Poll interval — slightly under the backend's 15-min cache TTL. */
const POLL_MS = 5 * 60 * 1000;

/**
 * Subscribe to the current space-weather snapshot.
 *
 * @example
 * ```tsx
 * const { data } = useSpaceWeather();
 * return data ? <SpaceWeatherBadge weather={data} /> : null;
 * ```
 */
export function useSpaceWeather(): UseQueryResult<SpaceWeather> {
  return useQuery({
    queryKey: SPACE_WEATHER_QUERY_KEY,
    queryFn: fetchSpaceWeather,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    staleTime: POLL_MS,
  });
}
