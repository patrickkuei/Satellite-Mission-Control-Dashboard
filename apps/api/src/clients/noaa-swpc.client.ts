/**
 * NOAA SWPC client — outbound fetch wrapper for the Space Weather Prediction
 * Center's public JSON products. Pure I/O: it knows which URLs to hit and how
 * to parse the heterogeneous response shapes into our normalized
 * {@link SpaceWeather} domain. Caching and freshness policy live one layer up
 * in the {@link WeatherRepository}; transformation never happens past this
 * file.
 *
 * NOAA's products are a quirky mix: some are CSV-shaped JSON arrays with a
 * header row, others are flat object arrays. The shapes can drift without
 * notice, so every parser is tolerant of missing/invalid rows and falls back
 * to the most-recent valid sample it finds.
 */
import type { SolarWind, SpaceWeather, WeatherSummary, XRayFlux } from '@orbit-ctrl/types';

/** Planetary K-index (Kp) — short-term forecast, latest row is "now-ish". */
const KP_INDEX_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
/**
 * Real-time solar-wind plasma at L1, 1-minute cadence.
 *
 * NOAA retired the old `products/solar-wind/plasma-1-day.json` tabular
 * product (404s as of 2026-09) in favor of this `json/rtsw/` object-array
 * product — see {@link fetchSolarWind} for the shape.
 */
const SOLAR_WIND_PLASMA_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json';
/**
 * Real-time solar-wind interplanetary magnetic field at L1, 1-minute cadence.
 * Same migration as {@link SOLAR_WIND_PLASMA_URL} — old `mag-1-day.json` 404s.
 */
const SOLAR_WIND_MAG_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json';
/** GOES X-ray flux, 6-hour rolling window. */
const XRAY_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json';

/** Public surface of the NOAA SWPC client. */
export interface NoaaSwpcClient {
  /**
   * Fetch a fully-populated space-weather snapshot.
   *
   * Issues four upstream requests in parallel; any individual failure throws
   * (the repository decides whether to fall back to a stale cache).
   *
   * @returns A fresh {@link SpaceWeather} record stamped with the fetch time.
   * @throws If any upstream product is unreachable or unparsable.
   */
  fetchSnapshot(): Promise<SpaceWeather>;
}

/**
 * Build a {@link NoaaSwpcClient} backed by the global `fetch`.
 *
 * @example
 * ```ts
 * const noaa = createNoaaSwpcClient();
 * const w = await noaa.fetchSnapshot();
 * // w.kpIndex ∈ [0, 9], w.summary ∈ 'quiet'|'unsettled'|'active'|'storm'
 * ```
 */
export function createNoaaSwpcClient(): NoaaSwpcClient {
  return {
    async fetchSnapshot() {
      const [kpIndex, solarWind, xrayFlux] = await Promise.all([
        fetchKpIndex(),
        fetchSolarWind(),
        fetchXRayFlux(),
      ]);
      return {
        kpIndex,
        solarWind,
        xrayFlux,
        summary: summarize(kpIndex, xrayFlux),
        fetchedAt: new Date().toISOString(),
      };
    },
  };
}

/**
 * Map a (Kp, X-ray) pair to a coarse summary used by UI badges and the agent.
 *
 * NOAA's official G-scale (G1–G5) starts at Kp = 5; we map ≥5 → `storm`. The
 * `active` band tracks NOAA's "active" geomagnetic label (Kp = 4) plus M-class
 * flares; `unsettled` is Kp ∈ [3, 4). Anything calmer is `quiet`.
 *
 * @internal exported for testing.
 */
export function summarize(kp: number, xray: XRayFlux): WeatherSummary {
  if (kp >= 5 || xray.class === 'X') return 'storm';
  if (kp >= 4 || xray.class === 'M') return 'active';
  if (kp >= 3) return 'unsettled';
  return 'quiet';
}

/**
 * Latest Kp from NOAA's 3-day forecast product.
 *
 * NOAA has shipped two formats for this endpoint at different points:
 *
 *   1. Object array (current as of 2026): `[{time_tag,kp,observed,...}, ...]`
 *   2. Tabular array with a header row: `[["time_tag","kp",...], [...], ...]`
 *
 * We accept both. The newest valid Kp value (last entry) is returned.
 */
async function fetchKpIndex(): Promise<number> {
  const raw = await fetchJson(KP_INDEX_URL);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('NOAA Kp product returned no rows');
  }
  for (let i = raw.length - 1; i >= 0; i--) {
    const row = raw[i];
    const kp = extractKp(row);
    if (kp !== null) return kp;
  }
  throw new Error('NOAA Kp product contained no parseable rows');
}

/** Pull a finite Kp ∈ [0, 9] from either format. Returns `null` if not found. */
function extractKp(row: unknown): number | null {
  if (Array.isArray(row)) {
    const candidate = Number(row[1]);
    return inKpRange(candidate) ? candidate : null;
  }
  if (row && typeof row === 'object' && 'kp' in row) {
    const candidate = Number((row as { kp: unknown }).kp);
    return inKpRange(candidate) ? candidate : null;
  }
  return null;
}

function inKpRange(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 9;
}

/** One record from `rtsw_wind_1m.json` — only the fields we consume. */
interface RtswWindRecord {
  active: boolean;
  proton_speed: number | null;
  proton_density: number | null;
}

/** One record from `rtsw_mag_1m.json` — only the fields we consume. */
interface RtswMagRecord {
  active: boolean;
  bz_gsm: number | null;
}

/**
 * Latest solar-wind sample. Plasma and magnetic-field products are separate;
 * we fetch both and combine.
 *
 * Both are object arrays, newest-first, with one record per timestamp *per
 * spacecraft* (multiple in-situ monitors — e.g. SOLAR1, ACE, IMAP — report in
 * parallel). NOAA flags the record it currently trusts with `active: true`;
 * we take the newest active+parseable record, falling back to the newest
 * parseable record of any source if NOAA ever ships a tick with no active
 * flag set.
 */
async function fetchSolarWind(): Promise<SolarWind> {
  const [wind, mag] = await Promise.all([
    fetchJson(SOLAR_WIND_PLASMA_URL) as Promise<RtswWindRecord[]>,
    fetchJson(SOLAR_WIND_MAG_URL) as Promise<RtswMagRecord[]>,
  ]);

  const windRow = firstMatchingRecord(
    wind,
    (r) => Number.isFinite(r.proton_speed) && Number.isFinite(r.proton_density),
  );
  const magRow = firstMatchingRecord(mag, (r) => Number.isFinite(r.bz_gsm));
  if (!windRow || !magRow) {
    throw new Error('NOAA solar-wind products returned no parseable rows');
  }

  return {
    densityProtonsCm3: Math.max(0, windRow.proton_density as number),
    speedKmS: Math.max(0, windRow.proton_speed as number),
    bzNanoTesla: magRow.bz_gsm as number,
  };
}

/**
 * Latest GOES X-ray flux. Product is an object array with the long-wavelength
 * channel (`energy === "0.1-0.8nm"`) we care about; we pick the most recent
 * sample of that channel and convert the W/m² flux into letter-class + mantissa.
 */
async function fetchXRayFlux(): Promise<XRayFlux> {
  const raw = (await fetchJson(XRAY_FLUX_URL)) as Array<{
    energy?: string;
    flux?: number;
    time_tag?: string;
  }>;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('NOAA X-ray flux product returned no rows');
  }
  const longChannel = raw.filter((r) => r.energy === '0.1-0.8nm' && Number.isFinite(r.flux));
  const latest = longChannel[longChannel.length - 1];
  if (!latest || typeof latest.flux !== 'number') {
    throw new Error('NOAA X-ray flux product contained no long-channel samples');
  }
  return fluxToLetterClass(latest.flux);
}

/**
 * Convert a W/m² flux value to NOAA's solar-flare letter scale.
 *
 * Bands are decades of W/m²:
 *   - `A`: < 1e-7
 *   - `B`: 1e-7 .. 1e-6
 *   - `C`: 1e-6 .. 1e-5
 *   - `M`: 1e-5 .. 1e-4
 *   - `X`: ≥ 1e-4 (mantissa can exceed 10 for the largest flares — clamped to
 *     the schema's positive constraint).
 *
 * @internal exported for testing.
 */
export function fluxToLetterClass(flux: number): XRayFlux {
  const safe = Math.max(flux, 1e-9);
  if (safe >= 1e-4) return { class: 'X', magnitude: round(safe / 1e-4) };
  if (safe >= 1e-5) return { class: 'M', magnitude: round(safe / 1e-5) };
  if (safe >= 1e-6) return { class: 'C', magnitude: round(safe / 1e-6) };
  if (safe >= 1e-7) return { class: 'B', magnitude: round(safe / 1e-7) };
  return { class: 'A', magnitude: round(Math.max(safe / 1e-8, 0.1)) };
}

/** Two-decimal rounding helper kept inline so we don't import lodash for one call. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Find the newest record in a `json/rtsw/` product (already newest-first)
 * that is both `active` and satisfies `isValid`. Falls back to the newest
 * record satisfying `isValid` regardless of `active` if none is flagged
 * active — defensive against NOAA shipping a tick with no active source.
 */
function firstMatchingRecord<T extends { active: boolean }>(
  rows: T[],
  isValid: (row: T) => boolean,
): T | null {
  if (!Array.isArray(rows)) return null;
  const active = rows.find((r) => r.active && isValid(r));
  if (active) return active;
  return rows.find(isValid) ?? null;
}

/** Thin `fetch` wrapper that throws on non-2xx with a useful message. */
async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`NOAA SWPC ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
