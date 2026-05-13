/**
 * TLE repository — owns the on-disk JSON cache for Celestrak TLE data.
 *
 * Celestrak asks API consumers to refresh no more than once per day; this
 * repository enforces that policy with a 24-hour TTL and a single JSON file.
 * Storage details (path, format, freshness check) are hidden behind the
 * {@link TLERepository} interface so services never touch `fs` directly.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Satellite } from '@orbit-ctrl/types';

/** Time-to-live for the on-disk cache. Celestrak's own refresh cadence. */
export const TLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Persisted cache envelope. `fetchedAt` is the time of the upstream fetch,
 * not the time of the most recent read; freshness is evaluated against that.
 */
export interface TLECacheFile {
  /** ISO 8601 timestamp of the upstream fetch. */
  fetchedAt: string;
  /** Satellites returned by the upstream fetch, in order. */
  satellites: Satellite[];
}

/** Public surface of the TLE repository. */
export interface TLERepository {
  /**
   * Read the cache file from disk. Returns `null` if the file doesn't exist
   * yet (first run). Any other I/O or parse error propagates so callers can
   * decide whether to fall back to a fresh fetch.
   */
  read(): Promise<TLECacheFile | null>;
  /** Atomically replace the cache file with a new payload. */
  write(satellites: Satellite[]): Promise<void>;
  /** True if `cache.fetchedAt` is within {@link TLE_CACHE_TTL_MS} of now. */
  isFresh(cache: TLECacheFile): boolean;
}

/** Construction-time dependencies for {@link createTLERepository}. */
export interface TLERepositoryDeps {
  /** Absolute path to the cache file (the parent directory is created on write). */
  cachePath: string;
}

/**
 * Build a {@link TLERepository} backed by a JSON file on disk.
 *
 * @example
 * ```ts
 * const repo = createTLERepository({ cachePath: '/var/orbit-ctrl/tle-cache.json' });
 * const cache = await repo.read();
 * if (!cache || !repo.isFresh(cache)) {
 *   const fresh = await celestrak.fetchGroup('stations');
 *   await repo.write(fresh);
 * }
 * ```
 */
export function createTLERepository(deps: TLERepositoryDeps): TLERepository {
  return {
    async read() {
      try {
        const raw = await fs.readFile(deps.cachePath, 'utf-8');
        return JSON.parse(raw) as TLECacheFile;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async write(satellites) {
      await fs.mkdir(path.dirname(deps.cachePath), { recursive: true });
      const payload: TLECacheFile = {
        fetchedAt: new Date().toISOString(),
        satellites,
      };
      await fs.writeFile(deps.cachePath, JSON.stringify(payload, null, 2), 'utf-8');
    },
    isFresh(cache) {
      const ageMs = Date.now() - new Date(cache.fetchedAt).getTime();
      return ageMs >= 0 && ageMs < TLE_CACHE_TTL_MS;
    },
  };
}
