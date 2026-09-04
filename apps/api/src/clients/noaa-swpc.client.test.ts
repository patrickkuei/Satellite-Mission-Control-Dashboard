import { jest } from '@jest/globals';
import { createNoaaSwpcClient } from './noaa-swpc.client.js';

// ---------------------------------------------------------------------------
// This suite exists to lock in the 2026-09 NOAA migration: the old tabular
// `plasma-1-day.json` / `mag-1-day.json` products 404 in production (see the
// Render crash logs this fix was written against) and were replaced by
// `json/rtsw/*_1m.json` object arrays that report multiple spacecraft per
// timestamp, newest-first, with an `active` flag marking which source NOAA
// currently trusts. That multi-source/active-preference logic is the part
// worth locking in — a plain "take the last row" parser (the old shape's
// contract) would silently pick the wrong spacecraft's reading here.
// ---------------------------------------------------------------------------

const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
const WIND_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json';
const MAG_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json';
const XRAY_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json';

const LATEST_TICK = '2026-09-04T07:06:00';
const VALID_KP = [{ time_tag: '2026-09-04T06:00:00Z', kp: 2.33, observed: 'observed' }];
const VALID_XRAY = [{ time_tag: `${LATEST_TICK}Z`, energy: '0.1-0.8nm', flux: 2.4e-6 }];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    json: async () => body,
  } as Response;
}

/** Route a mocked fetch by URL to a canned response, 404-ing anything unmapped. */
function mockFetch(routes: Record<string, unknown>): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input);
    if (url in routes) return jsonResponse(routes[url]);
    return jsonResponse({ error: 'unmapped' }, false, 404);
  }) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

describe('createNoaaSwpcClient — solar-wind parsing', () => {
  it('prefers the newest active-source record over other sources at the same timestamp', async () => {
    mockFetch({
      [KP_URL]: VALID_KP,
      [XRAY_URL]: VALID_XRAY,
      // Two spacecraft reporting the same tick — ACE is stale/untrusted, SOLAR1 is active.
      [WIND_URL]: [
        {
          time_tag: LATEST_TICK,
          active: false,
          source: 'ACE',
          proton_speed: 999,
          proton_density: 999,
        },
        {
          time_tag: LATEST_TICK,
          active: true,
          source: 'SOLAR1',
          proton_speed: 393.7,
          proton_density: 4.9,
        },
      ],
      [MAG_URL]: [
        { time_tag: LATEST_TICK, active: false, source: 'IMAP', bz_gsm: 999 },
        { time_tag: LATEST_TICK, active: true, source: 'SOLAR1', bz_gsm: -1.2 },
      ],
    });

    const snapshot = await createNoaaSwpcClient().fetchSnapshot();

    expect(snapshot.solarWind).toEqual({
      speedKmS: 393.7,
      densityProtonsCm3: 4.9,
      bzNanoTesla: -1.2,
    });
  });

  it('falls back to the newest parseable record when no source is flagged active', async () => {
    mockFetch({
      [KP_URL]: VALID_KP,
      [XRAY_URL]: VALID_XRAY,
      [WIND_URL]: [
        {
          time_tag: LATEST_TICK,
          active: false,
          source: 'SOLAR1',
          proton_speed: 400,
          proton_density: 5,
        },
        {
          time_tag: '2026-09-04T07:05:00',
          active: false,
          source: 'SOLAR1',
          proton_speed: 410,
          proton_density: 6,
        },
      ],
      [MAG_URL]: [{ time_tag: LATEST_TICK, active: false, source: 'SOLAR1', bz_gsm: -2 }],
    });

    const snapshot = await createNoaaSwpcClient().fetchSnapshot();

    // First (newest) row wins even though nothing is marked active.
    expect(snapshot.solarWind.speedKmS).toBe(400);
    expect(snapshot.solarWind.densityProtonsCm3).toBe(5);
  });

  it('throws a descriptive error when an upstream product 404s', async () => {
    mockFetch({
      [KP_URL]: VALID_KP,
      [XRAY_URL]: VALID_XRAY,
      [MAG_URL]: [{ time_tag: LATEST_TICK, active: true, source: 'SOLAR1', bz_gsm: -1 }],
      // WIND_URL intentionally left unmapped → 404, reproducing the migration break.
    });

    await expect(createNoaaSwpcClient().fetchSnapshot()).rejects.toThrow(
      `NOAA SWPC ${WIND_URL} failed: 404 Not Found`,
    );
  });
});
