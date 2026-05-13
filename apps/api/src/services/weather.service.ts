/**
 * Weather service — orchestrates the {@link NoaaSwpcClient} and the
 * {@link WeatherRepository} to expose the space-weather domain to the HTTP
 * layer.
 *
 * Reads are cache-first: a fresh in-memory snapshot is returned immediately;
 * a stale or missing snapshot triggers a fetch. Network failures fall back to
 * the stale cache (with a warning) so a flaky NOAA endpoint doesn't take the
 * dashboard offline.
 */
import type { SpaceWeather } from '@orbit-ctrl/types';
import type { NoaaSwpcClient } from '../clients/noaa-swpc.client.js';
import type { WeatherRepository } from '../repositories/weather.repository.js';

/** Minimal logger surface — narrow enough that any pino instance satisfies it. */
export interface WeatherServiceLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

/** Construction-time dependencies for the weather service. */
export interface WeatherServiceDeps {
  noaa: NoaaSwpcClient;
  repository: WeatherRepository;
  logger: WeatherServiceLogger;
}

/** Public surface of the weather service. */
export interface WeatherService {
  /**
   * Return the latest space-weather snapshot, refreshing the cache if stale.
   *
   * @throws Only when no cached snapshot exists AND the upstream fetch fails.
   */
  getCurrent(): Promise<SpaceWeather>;
}

/**
 * Build a {@link WeatherService} with explicit dependencies.
 *
 * @example
 * ```ts
 * const service = createWeatherService({ noaa, repository, logger });
 * const w = await service.getCurrent();
 * ```
 */
export function createWeatherService(deps: WeatherServiceDeps): WeatherService {
  let inflight: Promise<SpaceWeather> | null = null;

  async function refresh(): Promise<SpaceWeather> {
    const snapshot = await deps.noaa.fetchSnapshot();
    deps.repository.write(snapshot);
    deps.logger.info(
      `space-weather refreshed (kp=${snapshot.kpIndex} summary=${snapshot.summary})`,
    );
    return snapshot;
  }

  return {
    async getCurrent() {
      const cached = deps.repository.read();
      if (cached && deps.repository.isFresh(cached)) return cached;

      // Coalesce concurrent refreshes — the dashboard hits this endpoint from
      // multiple tabs and we don't want N parallel NOAA round-trips.
      if (!inflight) {
        inflight = refresh().catch((err: Error) => {
          deps.logger.warn(`space-weather fetch failed: ${err.message}`);
          if (cached) return cached;
          throw err;
        });
        inflight.finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
  };
}
