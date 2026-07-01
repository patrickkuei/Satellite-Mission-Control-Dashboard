import { jest } from '@jest/globals';
import { createSatelliteService } from './satellite.service.js';
import type { TLECacheFile } from '../repositories/tle.repository.js';
import type { Satellite } from '@orbit-ctrl/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSat = (noradId: number): Satellite => ({
  noradId,
  name: `SAT-${noradId}`,
  tle: {
    line1: '1 25544U 98067A   26179.67039743  .00005693  00000+0  10963-3 0  9998',
    line2: '2 25544  51.6320 243.2491 0004267 243.5322 116.5229 15.49468267573535',
    epoch: '2026-06-28T16:05:22.337Z',
  },
});

const FRESH_CACHE: TLECacheFile = {
  fetchedAt: new Date().toISOString(),
  satellites: [makeSat(1), makeSat(2)],
};

const makePosition = (noradId: number) => ({
  lat: 35,
  lon: 139,
  alt: 400,
  velocity: 7.7,
  timestamp: new Date().toISOString(),
  _id: noradId,
});

// ---------------------------------------------------------------------------
// Mock factories
//
// jest.fn() from @jest/globals returns Mock<UnknownFunction> whose
// .mockResolvedValue / .mockReturnValue / .mockImplementation methods have
// strict parameter types that don't match concrete signatures at compile time.
// We cast each mock to `any` before chaining so the object literals typecheck,
// then cast the final objects to `any` so they satisfy the interface expected
// by createSatelliteService.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const fn = (): any => jest.fn() as any;

function makeRepo(overrides: Record<string, any> = {}): any {
  return {
    read: fn().mockResolvedValue(FRESH_CACHE),
    write: fn().mockResolvedValue(undefined),
    isFresh: fn().mockReturnValue(true),
    ...overrides,
  };
}

function makeCelestrak(overrides: Record<string, any> = {}): any {
  return {
    fetchGroup: fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeOrbit(overrides: Record<string, any> = {}): any {
  return {
    positionAt: fn().mockImplementation((sat: unknown) => makePosition((sat as Satellite).noradId)),
    groundTrack: fn(),
    predictPasses: fn().mockResolvedValue([]),
    lookAnglesAt: fn().mockReturnValue(null),
    ...overrides,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SILENT_LOGGER = { info: fn(), warn: fn() };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSatelliteService', () => {
  describe('list()', () => {
    it('returns satellites from a fresh disk cache without hitting Celestrak', async () => {
      const celestrak = makeCelestrak();
      const service = createSatelliteService({
        celestrak,
        repository: makeRepo(),
        orbit: makeOrbit(),
        logger: SILENT_LOGGER,
      });

      const result = await service.list();

      expect(result).toHaveLength(2);
      expect(celestrak.fetchGroup).not.toHaveBeenCalled();
    });

    it('returns the same reference on a second call (memoCache hit)', async () => {
      const service = createSatelliteService({
        celestrak: makeCelestrak(),
        repository: makeRepo(),
        orbit: makeOrbit(),
        logger: SILENT_LOGGER,
      });

      const first = await service.list();
      const second = await service.list();
      expect(first).toBe(second);
    });

    it('falls back to snapshotUrl when Celestrak fails and disk cache is empty', async () => {
      const snapshotSats = [makeSat(99)];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).fetch = fn().mockResolvedValue({
        ok: true,
        json: async () => ({ satellites: snapshotSats }),
      });

      const service = createSatelliteService({
        celestrak: makeCelestrak({
          fetchGroup: fn().mockRejectedValue(new Error('403')),
        }),
        repository: makeRepo({
          read: fn().mockResolvedValue(null),
          isFresh: fn().mockReturnValue(false),
        }),
        orbit: makeOrbit(),
        logger: SILENT_LOGGER,
        snapshotUrl: 'https://example.com/snapshot.json',
      });

      const result = await service.list();
      expect(result[0]!.noradId).toBe(99);
    });
  });

  describe('listPositions()', () => {
    it('returns one position per satellite when all propagate successfully', async () => {
      const service = createSatelliteService({
        celestrak: makeCelestrak(),
        repository: makeRepo(),
        orbit: makeOrbit(),
        logger: SILENT_LOGGER,
      });

      const positions = await service.listPositions();
      expect(positions).toHaveLength(2);
    });

    it('skips satellites whose propagation throws instead of crashing the batch', async () => {
      const orbit = makeOrbit({
        positionAt: fn().mockImplementation((sat: unknown) => {
          if ((sat as Satellite).noradId === 2) throw new Error('SGP4 propagation failed');
          return makePosition((sat as Satellite).noradId);
        }),
      });

      const service = createSatelliteService({
        celestrak: makeCelestrak(),
        repository: makeRepo(),
        orbit,
        logger: SILENT_LOGGER,
      });

      const positions = await service.listPositions();
      expect(positions).toHaveLength(1);
    });

    it('returns an empty array when every satellite fails propagation', async () => {
      const orbit = makeOrbit({
        positionAt: fn().mockImplementation(() => {
          throw new Error('SGP4 propagation failed');
        }),
      });

      const service = createSatelliteService({
        celestrak: makeCelestrak(),
        repository: makeRepo(),
        orbit,
        logger: SILENT_LOGGER,
      });

      const positions = await service.listPositions();
      expect(positions).toHaveLength(0);
    });
  });
});
