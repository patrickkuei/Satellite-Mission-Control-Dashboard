import { jest } from '@jest/globals';
import { createSatelliteService } from './satellite.service.js';
import type { CelestrakClient } from '../clients/celestrak.client.js';
import type { TLERepository, TLECacheFile } from '../repositories/tle.repository.js';
import type { OrbitService } from './orbit.service.js';
import type { Position, Satellite } from '@orbit-ctrl/types';

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

const makePosition = (noradId: number): Position => ({
  lat: 35,
  lon: 139,
  alt: 400,
  velocity: 7.7,
  timestamp: new Date().toISOString(),
});

const FRESH_CACHE: TLECacheFile = {
  fetchedAt: new Date().toISOString(),
  satellites: [makeSat(1), makeSat(2)],
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<TLERepository> = {}): TLERepository {
  return {
    read: jest.fn().mockResolvedValue(FRESH_CACHE),
    write: jest.fn().mockResolvedValue(undefined),
    isFresh: jest.fn().mockReturnValue(true),
    ...overrides,
  };
}

function makeCelestrak(satellites: Satellite[] = []): CelestrakClient {
  return {
    fetchGroup: jest.fn().mockResolvedValue(satellites),
  };
}

function makeOrbit(overrides: Partial<OrbitService> = {}): OrbitService {
  return {
    positionAt: jest.fn().mockImplementation((sat: Satellite) => makePosition(sat.noradId)),
    groundTrack: jest.fn(),
    predictPasses: jest.fn().mockResolvedValue([]),
    lookAnglesAt: jest.fn().mockReturnValue(null),
    ...overrides,
  };
}

const SILENT_LOGGER = { info: jest.fn(), warn: jest.fn() };

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
      // Simulate a snapshot server returning one satellite.
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ satellites: snapshotSats }),
      } as unknown as Response);

      const service = createSatelliteService({
        celestrak: { fetchGroup: jest.fn().mockRejectedValue(new Error('403')) },
        repository: makeRepo({
          read: jest.fn().mockResolvedValue(null), // empty cache
          isFresh: jest.fn().mockReturnValue(false),
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
      // sat(1) propagates fine; sat(2) throws — listPositions should return only one result.
      const orbit = makeOrbit({
        positionAt: jest.fn().mockImplementation((sat: Satellite) => {
          if (sat.noradId === 2) throw new Error('SGP4 propagation failed');
          return makePosition(sat.noradId);
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
        positionAt: jest.fn().mockImplementation(() => {
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
