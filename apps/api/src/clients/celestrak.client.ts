/**
 * Celestrak client — outbound fetch wrapper for the Celestrak GP (General
 * Perturbations) endpoint. Pure I/O: it knows how to ask Celestrak for a
 * named group of satellites and how to turn the response into our internal
 * {@link Satellite} shape. Caching, persistence, and curation decisions live
 * one layer up in the service / repository.
 *
 * The TLE format is preferred over `FORMAT=json` because `satellite.js`
 * consumes the raw two-line strings directly via `twoline2satrec`; converting
 * Celestrak's OMM JSON back to TLE strings would re-introduce drift.
 */
import type { Satellite } from '@orbit-ctrl/types';

const CELESTRAK_GP_URL = 'https://celestrak.org/NORAD/elements/gp.php';

/**
 * Named Celestrak GP groups we mirror. Add new groups here as the demo grows
 * — keep the list short on purpose; the AI agent gets confused by 1000s of
 * satellites and the globe gets crowded above ~50.
 */
export const CELESTRAK_GROUPS = ['stations', 'starlink', 'science'] as const;
/** Union of supported Celestrak group identifiers. */
export type CelestrakGroup = (typeof CELESTRAK_GROUPS)[number];

/** Public surface of the Celestrak client. */
export interface CelestrakClient {
  /**
   * Fetch every satellite in a Celestrak group and parse the 3-line element
   * response into {@link Satellite} objects. Network and parse errors throw.
   *
   * @param group - Celestrak group name.
   * @returns Array of satellites in the order Celestrak returned them.
   */
  fetchGroup(group: CelestrakGroup): Promise<Satellite[]>;
}

/**
 * Build a {@link CelestrakClient} backed by the global `fetch`.
 *
 * @example
 * ```ts
 * const celestrak = createCelestrakClient();
 * const stations = await celestrak.fetchGroup('stations');
 * // stations[0].name === 'ISS (ZARYA)' (usually)
 * ```
 */
export function createCelestrakClient(): CelestrakClient {
  return {
    async fetchGroup(group) {
      const url = `${CELESTRAK_GP_URL}?GROUP=${group}&FORMAT=tle`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          'User-Agent':
            'orbit-ctrl/0.1.0 (portfolio; github.com/patrickkuei/Satellite-Mission-Control-Dashboard)',
        },
      });
      if (!res.ok) {
        throw new Error(`Celestrak GROUP=${group} failed: ${res.status} ${res.statusText}`);
      }
      return parse3LE(await res.text());
    },
  };
}

/**
 * Parse Celestrak's 3-line element response into {@link Satellite} records.
 *
 * The format alternates `name`, `line1`, `line2` for each satellite. Malformed
 * entries (wrong line length, non-numeric NORAD id) are skipped silently —
 * we'd rather return 49 valid satellites than fail the whole sync because of
 * one bad row.
 */
function parse3LE(text: string): Satellite[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const sats: Satellite[] = [];

  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!name || !line1 || !line2) continue;
    const sat = parse3LERecord(name, line1, line2);
    if (sat) sats.push(sat);
  }
  return sats;
}

/** Build a single {@link Satellite} from a 3-line record, or `null` if malformed. */
function parse3LERecord(name: string, line1: string, line2: string): Satellite | null {
  if (line1.length !== 69 || line2.length !== 69) return null;
  const noradId = Number(line1.slice(2, 7).trim());
  if (!Number.isInteger(noradId) || noradId <= 0) return null;
  return {
    noradId,
    name: name.trim(),
    tle: { line1, line2, epoch: parseTleEpoch(line1) },
  };
}

/**
 * Convert TLE line-1 columns 19–32 (`YYDDD.DDDDDDDD`) to an ISO 8601 string.
 *
 * Two-digit year disambiguation follows the NORAD convention: 00-56 ⇒ 21st
 * century, 57-99 ⇒ 20th century (Sputnik was launched in 1957).
 */
function parseTleEpoch(line1: string): string {
  const epochField = line1.slice(18, 32);
  const yy = Number(epochField.slice(0, 2));
  const dayOfYear = Number(epochField.slice(2));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const ms = (dayOfYear - 1) * 86_400_000;
  return new Date(Date.UTC(year, 0, 1) + ms).toISOString();
}
