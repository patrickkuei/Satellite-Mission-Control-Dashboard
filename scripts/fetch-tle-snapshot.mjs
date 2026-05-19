/**
 * Standalone script — fetches TLE data from Celestrak and writes a curated
 * satellite snapshot to `apps/web/public/satellites-snapshot.json`.
 *
 * Run by GitHub Actions every 2 days (GitHub runner IPs are not rate-limited
 * by Celestrak). The output file is served as a static asset from GitHub Pages
 * so the frontend can display cached satellite positions when the API server
 * is unreachable (cold start, Render free-tier sleep).
 *
 * Usage:
 *   node scripts/fetch-tle-snapshot.mjs
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '..', 'apps', 'web', 'public', 'satellites-snapshot.json');
const CELESTRAK_GP_URL = 'https://celestrak.org/NORAD/elements/gp.php';
const GROUPS = ['stations', 'starlink', 'science'];
const MAX_TRACKED = 50;

/** Featured NORAD IDs — must match satellite.service.ts. */
const FEATURED_NORAD_IDS = new Set([
  25544, // ISS (ZARYA)
  20580, // Hubble Space Telescope
  48274, // STARLINK-2613
  48275, // STARLINK-2614
  48276, // STARLINK-2615
]);

async function fetchGroup(group) {
  const url = `${CELESTRAK_GP_URL}?GROUP=${group}&FORMAT=tle`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      'User-Agent':
        'orbit-ctrl/0.1.0 (portfolio; github.com/patrickkuei/Satellite-Mission-Control-Dashboard)',
    },
  });
  if (!res.ok) throw new Error(`Celestrak GROUP=${group} failed: ${res.status} ${res.statusText}`);
  return parse3LE(await res.text());
}

function parse3LE(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const sats = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!name || !line1 || !line2) continue;
    if (line1.length !== 69 || line2.length !== 69) continue;
    const noradId = Number(line1.slice(2, 7).trim());
    if (!Number.isInteger(noradId) || noradId <= 0) continue;
    const epochField = line1.slice(18, 32);
    const yy = Number(epochField.slice(0, 2));
    const dayOfYear = Number(epochField.slice(2));
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const epoch = new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000).toISOString();
    sats.push({ noradId, name: name.trim(), tle: { line1, line2, epoch } });
  }
  return sats;
}

function curate(all) {
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

async function main() {
  console.log('Fetching TLE groups from Celestrak…');
  const results = await Promise.allSettled(GROUPS.map(fetchGroup));

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');

  if (failed.length > 0) {
    console.warn(`${failed.length} group(s) failed:`);
    failed.forEach((r) => console.warn(' -', r.reason?.message ?? r.reason));
  }

  if (fulfilled.length === 0) {
    console.error('All groups failed — aborting, snapshot not updated.');
    process.exit(1);
  }

  const all = fulfilled.flatMap((r) => r.value);
  const curated = curate(all);
  const payload = { fetchedAt: new Date().toISOString(), satellites: curated };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf-8');

  console.log(`✓ Snapshot written: ${curated.length} satellites → ${OUTPUT_PATH}`);
  console.log(`  fetchedAt: ${payload.fetchedAt}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
