/**
 * Weather repository — in-memory cache of the latest NOAA SWPC snapshot.
 *
 * NOAA's products update at most every few minutes; we cache the last
 * successful snapshot in process for 15 minutes (the polling cadence promised
 * by the architecture brief). Storage is intentionally non-durable: a fresh
 * process boot pulls a fresh snapshot.
 */
import type { SpaceWeather } from '@orbit-ctrl/types';

/** Time-to-live for an in-memory snapshot. */
export const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000;

/** Public surface of the weather repository. */
export interface WeatherRepository {
  /** Last cached snapshot, or `null` if nothing has been stored yet. */
  read(): SpaceWeather | null;
  /** Replace the cached snapshot with a freshly-fetched one. */
  write(snapshot: SpaceWeather): void;
  /** True if the cached snapshot is within {@link WEATHER_CACHE_TTL_MS} of now. */
  isFresh(snapshot: SpaceWeather): boolean;
}

/**
 * Build an in-memory {@link WeatherRepository}.
 *
 * @example
 * ```ts
 * const repo = createWeatherRepository();
 * repo.write(snapshot);
 * const hit = repo.read();
 * if (hit && repo.isFresh(hit)) return hit;
 * ```
 */
export function createWeatherRepository(): WeatherRepository {
  let memo: SpaceWeather | null = null;
  return {
    read: () => memo,
    write: (snapshot) => {
      memo = snapshot;
    },
    isFresh(snapshot) {
      const ageMs = Date.now() - new Date(snapshot.fetchedAt).getTime();
      return ageMs >= 0 && ageMs < WEATHER_CACHE_TTL_MS;
    },
  };
}
