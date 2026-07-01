import { createOrbitService, DEFAULT_GROUND_TRACK_MINUTES } from './orbit.service.js';
import type { Satellite } from '@orbit-ctrl/types';

/**
 * Real ISS TLE from 2026-06-28. SGP4 propagation within a few days of epoch
 * is expected to succeed and produce plausible geodetic coordinates.
 */
const ISS: Satellite = {
  noradId: 25544,
  name: 'ISS (ZARYA)',
  tle: {
    line1: '1 25544U 98067A   26179.67039743  .00005693  00000+0  10963-3 0  9998',
    line2: '2 25544  51.6320 243.2491 0004267 243.5322 116.5229 15.49468267573535',
    epoch: '2026-06-28T16:05:22.337Z',
  },
};

/** Epoch + 1 hour — comfortably within the TLE's accuracy window. */
const EPOCH_PLUS_1H = new Date('2026-06-28T17:05:22.337Z');

/** Observer at Tokyo for pass / look-angle tests. */
const TOKYO = { lat: 35.6895, lon: 139.6917 };

describe('createOrbitService', () => {
  const orbit = createOrbitService();

  describe('positionAt', () => {
    it('returns a geodetic position within physically valid bounds', () => {
      const pos = orbit.positionAt(ISS, EPOCH_PLUS_1H);

      expect(pos.lat).toBeGreaterThanOrEqual(-90);
      expect(pos.lat).toBeLessThanOrEqual(90);
      expect(pos.lon).toBeGreaterThanOrEqual(-180);
      expect(pos.lon).toBeLessThanOrEqual(180);
      // ISS orbits at ~400 km altitude.
      expect(pos.alt).toBeGreaterThan(200);
      expect(pos.alt).toBeLessThan(600);
      // ISS orbital velocity is ~7.7 km/s.
      expect(pos.velocity).toBeGreaterThan(6);
      expect(pos.velocity).toBeLessThan(9);
    });

    it('returns an ISO 8601 timestamp matching the requested instant', () => {
      const pos = orbit.positionAt(ISS, EPOCH_PLUS_1H);
      expect(pos.timestamp).toBe(EPOCH_PLUS_1H.toISOString());
    });

    it('throws when SGP4 propagation fails', () => {
      // A satellite with all-zero TLE fields forces satellite.js to return
      // position: false, which our guard converts to a thrown error.
      const badSat: Satellite = {
        noradId: 0,
        name: 'BAD',
        tle: {
          line1: '1 00000U 00000A   00000.00000000  .00000000  00000-0  00000-0 0  0000',
          line2: '2 00000   0.0000   0.0000 0000000   0.0000   0.0000  0.00000000000000',
          epoch: '2000-01-01T00:00:00.000Z',
        },
      };
      expect(() => orbit.positionAt(badSat, new Date())).toThrow('SGP4 propagation failed');
    });
  });

  describe('groundTrack', () => {
    it('returns the correct number of points for the default window', () => {
      const track = orbit.groundTrack(ISS, EPOCH_PLUS_1H);
      // Default step is 30 s; expected count = floor(periodMin*60/30) + 1.
      const expectedPoints = Math.floor((DEFAULT_GROUND_TRACK_MINUTES * 60) / 30) + 1;
      expect(track.points).toHaveLength(expectedPoints);
      expect(track.satelliteId).toBe(ISS.noradId);
    });

    it('each point in the track has valid coordinates', () => {
      const track = orbit.groundTrack(ISS, EPOCH_PLUS_1H, 10);
      for (const pt of track.points) {
        expect(pt.lat).toBeGreaterThanOrEqual(-90);
        expect(pt.lat).toBeLessThanOrEqual(90);
        expect(pt.lon).toBeGreaterThanOrEqual(-180);
        expect(pt.lon).toBeLessThanOrEqual(180);
      }
    });
  });

  describe('lookAnglesAt', () => {
    it('returns non-null look angles for a valid satellite and observer', () => {
      const angles = orbit.lookAnglesAt(ISS, TOKYO, EPOCH_PLUS_1H);
      // May or may not be above the horizon; the result should be non-null.
      expect(angles).not.toBeNull();
      if (angles) {
        expect(angles.elevationDeg).toBeGreaterThanOrEqual(-90);
        expect(angles.elevationDeg).toBeLessThanOrEqual(90);
        expect(angles.azimuthDeg).toBeGreaterThanOrEqual(0);
        expect(angles.azimuthDeg).toBeLessThanOrEqual(360);
        expect(angles.rangeKm).toBeGreaterThan(0);
      }
    });
  });

  describe('predictPasses', () => {
    it('returns an array (may be empty if none in window)', () => {
      const passes = orbit.predictPasses(ISS, TOKYO, EPOCH_PLUS_1H, 2);
      expect(Array.isArray(passes)).toBe(true);
    });

    it('each pass has start before end and a positive duration', () => {
      const passes = orbit.predictPasses(ISS, TOKYO, EPOCH_PLUS_1H, 24);
      for (const p of passes) {
        expect(new Date(p.startTime).getTime()).toBeLessThan(new Date(p.endTime).getTime());
        expect(p.durationSeconds).toBeGreaterThan(0);
        expect(p.maxElevationDeg).toBeGreaterThan(0);
        expect(p.maxElevationDeg).toBeLessThanOrEqual(90);
      }
    });
  });
});
