/**
 * Satellite service — orchestrates the Celestrak client, the TLE cache, and
 * the {@link OrbitService} to expose the satellite-tracking domain to the
 * HTTP layer.
 *
 * Curation lives here rather than in the client because it's a product
 * decision, not a transport detail: we want a *small* curated set of
 * satellites for the demo (ISS, Hubble, a handful of Starlinks) — not
 * thousands. If the curated NORAD IDs aren't found in the upstream response,
 * we pad with whatever Celestrak returned so the globe is never empty.
 */
import type { GroundTrack, ObserverLocation, Pass, Position, Satellite } from '@orbit-ctrl/types';
import type { CelestrakClient, CelestrakGroup } from '../clients/celestrak.client.js';
import { CELESTRAK_GROUPS } from '../clients/celestrak.client.js';
import type { TLERepository } from '../repositories/tle.repository.js';
import type { OrbitService } from './orbit.service.js';

/** Hard cap on how many satellites the curated demo set may contain. */
const MAX_TRACKED = 50;

/**
 * Featured NORAD IDs — the satellites we want guaranteed-visible in the demo
 * if Celestrak returns them. Order is irrelevant. Starlink IDs are sampled
 * from the most-recent published batches; if they re-enter we'll fall back
 * to the padding logic below.
 */
const FEATURED_NORAD_IDS: ReadonlySet<number> = new Set([
  25544, // ISS (ZARYA)
  20580, // Hubble Space Telescope
  48274, // STARLINK-2613
  48275, // STARLINK-2614
  48276, // STARLINK-2615
]);

/** Minimal logger surface — narrow enough that any pino instance satisfies it. */
export interface SatelliteServiceLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

/** Construction-time dependencies for the satellite service. */
export interface SatelliteServiceDeps {
  celestrak: CelestrakClient;
  repository: TLERepository;
  orbit: OrbitService;
  logger: SatelliteServiceLogger;
  /**
   * Optional read-only repository pointing at the committed TLE snapshot
   * (`apps/api/data/satellites-snapshot.json`). Used as a last-resort fallback
   * when both Celestrak and the runtime disk cache are unavailable — e.g. on a
   * fresh Render deploy whose egress IP is temporarily blocked by Celestrak.
   * Refreshed every 2 days by the `update-tle-snapshot` GitHub Actions workflow.
   */
  snapshotRepository?: Pick<TLERepository, 'read'>;
}

/** One entry in the list returned by {@link SatelliteService.findAbove}. */
export interface VisibleSatellite {
  name: string;
  noradId: number;
  /** Elevation above horizon in degrees (0 = horizon, 90 = zenith). */
  elevationDeg: number;
  /** Azimuth clockwise from north in degrees. */
  azimuthDeg: number;
  /** Slant range from observer to satellite in kilometres. */
  rangeKm: number;
}

/** Public surface of the satellite service. */
export interface SatelliteService {
  /** Return the curated list of tracked satellites, populating the cache on first call. */
  list(): Promise<Satellite[]>;
  /** Current/historical position of one satellite. Defaults to "now". */
  positionOf(noradId: number, time?: Date): Promise<Position>;
  /** Future ground track of one satellite over `periodMin` minutes. Defaults to ~90. */
  groundTrack(noradId: number, periodMin?: number): Promise<GroundTrack>;
  /** Current positions of every tracked satellite. Optimised batch endpoint. */
  listPositions(time?: Date): Promise<Position[]>;
  /**
   * Predict visible passes of one satellite over a ground observer.
   *
   * @param noradId  - Curated-set NORAD ID.
   * @param observer - Ground observer (lat/lon degrees, optional altMeters).
   * @param hours    - Forward window length in hours.
   */
  passesOf(noradId: number, observer: ObserverLocation, hours: number): Promise<Pass[]>;
  /**
   * Return all currently tracked satellites above the horizon at `observer`,
   * sorted by elevation descending. Capped at 10 results.
   *
   * @param observer        - Ground observer (lat/lon degrees).
   * @param minElevationDeg - Minimum elevation to include (default 0°).
   * @example
   * ```ts
   * const visible = await service.findAbove({ lat: 35.68, lon: 139.69 });
   * console.log(visible[0].name); // highest satellite
   * ```
   */
  findAbove(observer: ObserverLocation, minElevationDeg?: number): Promise<VisibleSatellite[]>;
}

/**
 * Build a {@link SatelliteService} with explicit dependencies. The first
 * call to any method loads the cache and (if stale) hits Celestrak; later
 * calls reuse the in-memory list.
 */
export function createSatelliteService(deps: SatelliteServiceDeps): SatelliteService {
  let memoCache: Satellite[] | null = null;
  // Shared in-flight promise: if the prefetch and a concurrent request both call
  // ensureLoaded before the first fetch completes, they share one Celestrak round-trip
  // rather than issuing two parallel fetches (which wastes quota and risks rate-limits).
  let loadingPromise: Promise<Satellite[]> | null = null;

  async function ensureLoaded(): Promise<Satellite[]> {
    // Strict null check — [] is truthy, so `if (memoCache)` would permanently
    // cache a failed load and never retry.
    if (memoCache !== null) return memoCache;
    if (loadingPromise) return loadingPromise;
    loadingPromise = loadFromCacheOrFetch(deps)
      .then((loaded) => {
        if (loaded.length > 0) memoCache = loaded;
        loadingPromise = null;
        return loaded;
      })
      .catch((err: unknown) => {
        // Clear the in-flight reference so the next call retries.
        loadingPromise = null;
        throw err;
      });
    return loadingPromise;
  }

  async function findSatellite(noradId: number): Promise<Satellite> {
    const list = await ensureLoaded();
    const sat = list.find((s) => s.noradId === noradId);
    if (!sat) throw new SatelliteNotFoundError(noradId);
    return sat;
  }

  return {
    list: ensureLoaded,
    async positionOf(noradId, time = new Date()) {
      const sat = await findSatellite(noradId);
      return deps.orbit.positionAt(sat, time);
    },
    async groundTrack(noradId, periodMin) {
      const sat = await findSatellite(noradId);
      return deps.orbit.groundTrack(sat, new Date(), periodMin);
    },
    async listPositions(time = new Date()) {
      const all = await ensureLoaded();
      return all.map((s) => deps.orbit.positionAt(s, time));
    },
    async passesOf(noradId, observer, hours) {
      const sat = await findSatellite(noradId);
      return deps.orbit.predictPasses(sat, observer, new Date(), hours);
    },
    async findAbove(observer, minElevationDeg = 0) {
      const all = await ensureLoaded();
      const now = new Date();
      const visible = all
        .map((sat) => {
          const look = deps.orbit.lookAnglesAt(sat, observer, now);
          if (!look) return null;
          return {
            name: sat.name,
            noradId: sat.noradId,
            elevationDeg: Math.round(look.elevationDeg * 100) / 100,
            azimuthDeg: Math.round(look.azimuthDeg * 100) / 100,
            rangeKm: Math.round(look.rangeKm * 100) / 100,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null && s.elevationDeg >= minElevationDeg)
        .sort((a, b) => b.elevationDeg - a.elevationDeg);
      return visible.slice(0, 10);
    },
  };
}

/** Error thrown when a requested NORAD ID isn't in the curated tracked set. */
export class SatelliteNotFoundError extends Error {
  constructor(public readonly noradId: number) {
    super(`Satellite ${noradId} is not in the tracked set`);
    this.name = 'SatelliteNotFoundError';
  }
}

/**
 * Read the cache if fresh, otherwise fetch from Celestrak, curate, and
 * persist before returning. Network failures fall back to a stale cache
 * (with a warning) so the demo can still load offline-ish.
 */
async function loadFromCacheOrFetch(deps: SatelliteServiceDeps): Promise<Satellite[]> {
  const stored = await deps.repository.read();
  // A fresh but empty cache means a previous bad run wrote it — treat as stale
  // so we always attempt a real Celestrak fetch when there's no usable data.
  if (stored && deps.repository.isFresh(stored) && stored.satellites.length > 0) {
    deps.logger.info(`tle-cache hit (${stored.satellites.length} satellites)`);
    return stored.satellites;
  }
  try {
    const fresh = await fetchAllGroups(deps.celestrak);
    const curated = curate(fresh);
    // Only persist a non-empty result — an empty curated list would poison the
    // disk cache and be served as "fresh" on the next cold start.
    if (curated.length > 0) {
      await deps.repository.write(curated);
      deps.logger.info(`tle-cache refreshed (${curated.length} satellites)`);
    }
    return curated;
  } catch (err) {
    const msg = (err as Error).message;
    // Fallback 1: stale runtime disk cache (same Render instance, any age).
    if (stored && stored.satellites.length > 0) {
      deps.logger.warn(`celestrak fetch failed, serving stale cache: ${msg}`);
      return stored.satellites;
    }
    // Fallback 2: committed snapshot bundled in the Docker image.
    // Refreshed every 2 days by the update-tle-snapshot GitHub Actions workflow
    // from GitHub runner IPs, which are not rate-limited by Celestrak.
    if (deps.snapshotRepository) {
      const snapshot = await deps.snapshotRepository.read().catch(() => null);
      if (snapshot && snapshot.satellites.length > 0) {
        deps.logger.warn(
          `celestrak fetch failed, serving bundled snapshot (${snapshot.satellites.length} sats, fetched ${snapshot.fetchedAt}): ${msg}`,
        );
        return snapshot.satellites;
      }
    }
    // No data at all — return empty so the API responds 200 rather than 500.
    // Frontend retries via useSatellites (retry: 8) and recovers once Celestrak
    // becomes reachable.
    deps.logger.warn(`celestrak fetch failed, no fallback available: ${msg}`);
    return [];
  }
}

/**
 * Fetch every supported group in parallel and flatten the result.
 * Individual group failures are tolerated — a single 403/timeout won't
 * abort the whole sync. But if *every* group fails we throw so the caller
 * can fall back to a stale cache rather than caching an empty list.
 *
 * @throws When all groups fail (total Celestrak outage / rate-limit).
 */
async function fetchAllGroups(client: CelestrakClient): Promise<Satellite[]> {
  const results = await Promise.allSettled(
    CELESTRAK_GROUPS.map((g: CelestrakGroup) => client.fetchGroup(g)),
  );
  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<Satellite[]> => r.status === 'fulfilled',
  );
  if (fulfilled.length === 0) {
    const reasons = results
      .map((r) => (r.status === 'rejected' ? String(r.reason) : ''))
      .join('; ');
    throw new Error(`All Celestrak groups failed: ${reasons}`);
  }
  return fulfilled.flatMap((r) => r.value);
}

/**
 * Reduce the raw upstream list to the curated demo set:
 *   1. Take every featured satellite that's present.
 *   2. Pad with the first non-featured satellites until we hit MAX_TRACKED.
 */
function curate(all: Satellite[]): Satellite[] {
  const featured = all.filter((s) => FEATURED_NORAD_IDS.has(s.noradId));
  const seen = new Set(featured.map((s) => s.noradId));
  const result = [...featured];

  for (const sat of all) {
    if (result.length >= MAX_TRACKED) break;
    if (seen.has(sat.noradId)) continue;
    result.push(sat);
    seen.add(sat.noradId);
  }
  return result;
}
