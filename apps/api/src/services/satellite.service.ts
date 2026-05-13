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
const MAX_TRACKED = 12;

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
}

/**
 * Build a {@link SatelliteService} with explicit dependencies. The first
 * call to any method loads the cache and (if stale) hits Celestrak; later
 * calls reuse the in-memory list.
 */
export function createSatelliteService(deps: SatelliteServiceDeps): SatelliteService {
  let memoCache: Satellite[] | null = null;

  async function ensureLoaded(): Promise<Satellite[]> {
    if (memoCache) return memoCache;
    memoCache = await loadFromCacheOrFetch(deps);
    return memoCache;
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
  if (stored && deps.repository.isFresh(stored)) {
    deps.logger.info(`tle-cache hit (${stored.satellites.length} satellites)`);
    return stored.satellites;
  }
  try {
    const fresh = await fetchAllGroups(deps.celestrak);
    const curated = curate(fresh);
    await deps.repository.write(curated);
    deps.logger.info(`tle-cache refreshed (${curated.length} satellites)`);
    return curated;
  } catch (err) {
    if (stored) {
      deps.logger.warn(`celestrak fetch failed, serving stale cache: ${(err as Error).message}`);
      return stored.satellites;
    }
    throw err;
  }
}

/** Fetch every supported group in parallel and flatten the result. */
async function fetchAllGroups(client: CelestrakClient): Promise<Satellite[]> {
  const perGroup = await Promise.all(
    CELESTRAK_GROUPS.map((g: CelestrakGroup) => client.fetchGroup(g)),
  );
  return perGroup.flat();
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
