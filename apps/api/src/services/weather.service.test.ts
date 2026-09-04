import { jest } from '@jest/globals';
import { createWeatherService } from './weather.service.js';
import type { SpaceWeather } from '@orbit-ctrl/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FETCH_FAILURE_MESSAGE = 'NOAA SWPC 404 Not Found';

function makeSnapshot(overrides: Partial<SpaceWeather> = {}): SpaceWeather {
  return {
    kpIndex: 2,
    solarWind: { speedKmS: 400, densityProtonsCm3: 5, bzNanoTesla: -1 },
    xrayFlux: { class: 'B', magnitude: 1.2 },
    summary: 'quiet',
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factories — see satellite.service.test.ts for why mocks are cast
// through `any`: jest.fn()'s mock-method typing doesn't unify with concrete
// signatures under this project's ESM ts-jest setup.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const fn = (): any => jest.fn() as any;

function makeRepository(
  initial: SpaceWeather | null = null,
  overrides: Record<string, any> = {},
): any {
  let memo = initial;
  return {
    read: fn().mockImplementation(() => memo),
    write: fn().mockImplementation((snapshot: unknown) => {
      memo = snapshot as SpaceWeather;
    }),
    isFresh: fn().mockReturnValue(true),
    ...overrides,
  };
}

function makeNoaa(overrides: Record<string, any> = {}): any {
  return {
    fetchSnapshot: fn().mockResolvedValue(makeSnapshot()),
    ...overrides,
  };
}

const SILENT_LOGGER = { info: fn(), warn: fn() };
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createWeatherService', () => {
  it('returns the cached snapshot without hitting NOAA when fresh', async () => {
    const cached = makeSnapshot();
    const noaa = makeNoaa();
    const service = createWeatherService({
      noaa,
      repository: makeRepository(cached),
      logger: SILENT_LOGGER,
    });

    await expect(service.getCurrent()).resolves.toBe(cached);
    expect(noaa.fetchSnapshot).not.toHaveBeenCalled();
  });

  it('refreshes and caches a fresh snapshot when none is cached', async () => {
    const fresh = makeSnapshot({ kpIndex: 4 });
    const repository = makeRepository(null);
    const noaa = makeNoaa({ fetchSnapshot: fn().mockResolvedValue(fresh) });
    const service = createWeatherService({ noaa, repository, logger: SILENT_LOGGER });

    await expect(service.getCurrent()).resolves.toBe(fresh);
    expect(repository.read()).toBe(fresh);
  });

  it('falls back to the stale cache when the upstream fetch fails', async () => {
    const stale = makeSnapshot();
    const repository = makeRepository(stale, { isFresh: fn().mockReturnValue(false) });
    const noaa = makeNoaa({
      fetchSnapshot: fn().mockRejectedValue(new Error(FETCH_FAILURE_MESSAGE)),
    });
    const service = createWeatherService({ noaa, repository, logger: SILENT_LOGGER });

    await expect(service.getCurrent()).resolves.toBe(stale);
    expect(SILENT_LOGGER.warn).toHaveBeenCalledWith(
      expect.stringContaining('space-weather fetch failed'),
    );
  });

  it('rejects when the upstream fetch fails and there is no cache, without an unhandled rejection', async () => {
    const repository = makeRepository(null);
    const noaa = makeNoaa({
      fetchSnapshot: fn().mockRejectedValue(new Error(FETCH_FAILURE_MESSAGE)),
    });
    const service = createWeatherService({ noaa, repository, logger: SILENT_LOGGER });

    // Regression test: `inflight.finally(...)` used to create a second,
    // never-consumed promise adopting the same rejection — crashing the
    // process even though the caller's own promise (returned below) was
    // properly handled.
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(service.getCurrent()).rejects.toThrow(FETCH_FAILURE_MESSAGE);
      // Let any dangling derived promise from `.finally()` surface before asserting.
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('coalesces concurrent calls into a single upstream fetch', async () => {
    const fresh = makeSnapshot();
    const repository = makeRepository(null);
    const noaa = makeNoaa({ fetchSnapshot: fn().mockResolvedValue(fresh) });
    const service = createWeatherService({ noaa, repository, logger: SILENT_LOGGER });

    const [a, b] = await Promise.all([service.getCurrent(), service.getCurrent()]);

    expect(a).toBe(fresh);
    expect(b).toBe(fresh);
    expect(noaa.fetchSnapshot).toHaveBeenCalledTimes(1);
  });
});
