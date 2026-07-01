/**
 * Satellite service — orchestrates the Celestrak client, the TLE cache, and
 * the {@link OrbitService} to expose the satellite-tracking domain to the
 * HTTP layer.
 *
 * Curation lives here rather than in the client because it's a product
 * decision, not a transport detail: we want a small curated set of satellites
 * for the demo, not thousands. Featured NORAD IDs are prioritised; the rest
 * of the cap is filled from whatever Celestrak returned.
 */
import type { GroundTrack, ObserverLocation, Pass, Position, Satellite } from '@orbit-ctrl/types';
import type { CelestrakClient, CelestrakGroup } from '../clients/celestrak.client.js';
import { CELESTRAK_GROUPS } from '../clients/celestrak.client.js';
import type { TLERepository } from '../repositories/tle.repository.js';
import type { OrbitService } from './orbit.service.js';

const MAX_TRACKED = 50;

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
   * URL of the remote TLE snapshot (e.g. GH Pages or object storage).
   * Fetched as a last resort when Celestrak and the disk cache both fail.
   * In production this would point to S3/GCS updated by a data pipeline.
   */
  snapshotUrl?: string;
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
  // Shared promise so concurrent callers (e.g. the onReady prefetch + first
  // request) share one Celestrak round-trip instead of issuing duplicates.
  let loadingPromise: Promise<Satellite[]> | null = null;

  async function ensureLoaded(): Promise<Satellite[]> {
    if (memoCache !== null) return memoCache;
    if (loadingPromise) return loadingPromise;
    loadingPromise = loadFromCacheOrFetch(deps)
      .then((loaded) => {
        if (loaded.length > 0) memoCache = loaded;
        loadingPromise = null;
        return loaded;
      })
      .catch((err: unknown) => {
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
      return all.flatMap((s) => {
        try {
          return [deps.orbit.positionAt(s, time)];
        } catch {
          return [];
        }
      });
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
 * Load satellite data using a four-level fallback chain:
 *   1. Fresh disk cache (within 24 h TTL, non-empty)
 *   2. Live Celestrak fetch → write to disk cache
 *   3. Stale disk cache → any age, if Celestrak fails
 *   4. Remote snapshot (`snapshotUrl`) — GH Pages in demo, object storage in prod
 *
 * Throws when all sources fail — callers should surface a 503 rather than
 * return an empty list, so the frontend's retry logic can fire correctly.
 */
async function loadFromCacheOrFetch(deps: SatelliteServiceDeps): Promise<Satellite[]> {
  const stored = await deps.repository.read();
  if (stored && deps.repository.isFresh(stored) && stored.satellites.length > 0) {
    deps.logger.info(`tle-cache hit (${stored.satellites.length} satellites)`);
    return stored.satellites;
  }

  try {
    const fresh = await fetchAllGroups(deps.celestrak);
    const curated = curate(fresh);
    if (curated.length > 0) {
      await deps.repository.write(curated);
      deps.logger.info(`tle-cache refreshed (${curated.length} satellites)`);
    }
    return curated;
  } catch (err) {
    const msg = (err as Error).message;

    if (stored && stored.satellites.length > 0) {
      deps.logger.warn(`Celestrak failed, serving stale cache: ${msg}`);
      return stored.satellites;
    }

    if (deps.snapshotUrl) {
      const snapshot = await fetchRemoteSnapshot(deps.snapshotUrl).catch(() => null);
      if (snapshot && snapshot.length > 0) {
        deps.logger.warn(`Celestrak failed, serving remote snapshot (${deps.snapshotUrl}): ${msg}`);
        return snapshot;
      }
    }

    throw new Error(`No satellite data available: ${msg}`);
  }
}

/**
 * Fetch and parse the remote TLE snapshot. The snapshot shape mirrors the
 * file written by `scripts/fetch-tle-snapshot.mjs`:
 * `{ fetchedAt: string; satellites: Satellite[] }`.
 *
 * @param url - Full URL to the snapshot JSON (GH Pages, S3, GCS, etc.).
 */
async function fetchRemoteSnapshot(url: string): Promise<Satellite[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Snapshot fetch failed: ${res.status}`);
  const payload = (await res.json()) as { satellites: Satellite[] };
  return payload.satellites ?? [];
}

/**
 * Fetch all Celestrak groups in parallel. Tolerates individual group failures
 * (403, timeout) but throws when every group fails so callers can fall back.
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
