/**
 * Telemetry service — synthetic 1 Hz telemetry generator.
 *
 * Produces realistic-looking samples driven by orbital geometry rather than
 * pure noise: bus voltage drops in eclipse, internal temperature cycles with
 * the day/night thermal phase, and attitude rates random-walk around zero.
 *
 * Stateful per-satellite (it remembers the last attitude for the random-walk
 * integration), but stateless across restarts — the demo doesn't persist
 * telemetry history beyond the in-memory anomaly window.
 *
 * Eclipse detection uses a low-order approximation of the sub-solar point
 * derived from the UTC clock; good to a few degrees, which is far more
 * accurate than the demo needs.
 */
import type { Attitude, Satellite, Telemetry } from '@orbit-ctrl/types';
import type { OrbitService } from './orbit.service.js';

/** Nominal bus voltage (V) when the satellite is sunlit. */
const VOLTAGE_NOMINAL = 28;
/** Voltage drop (V) once the satellite enters Earth's shadow. */
const VOLTAGE_ECLIPSE_DROP = 4;
/** Peak-to-peak amplitude of the day/night thermal swing (°C). */
const TEMP_SWING_C = 40;
/** Mean internal temperature (°C) across an orbit. */
const TEMP_MEAN_C = 10;
/** Attitude step size (deg / second) — per-axis Gaussian-ish random walk. */
const ATTITUDE_STEP_DEG = 0.05;
/** Soft cap on |attitude| (deg). Beyond this the walk is pulled toward zero. */
const ATTITUDE_CAP_DEG = 1.5;
/** Per-sample probability of triggering a new fault while nominal. */
const ANOMALY_PROB = 0.02;
/** Once triggered, a fault persists for this many ticks before recovery. */
const FAULT_DURATION_SAMPLES = 5;
/** Earth radius (km), used for eclipse half-angle. */
const EARTH_RADIUS_KM = 6371;
/** Obliquity of the ecliptic (deg) — approximation. */
const OBLIQUITY_DEG = 23.44;

/** Construction-time dependencies for the telemetry service. */
export interface TelemetryServiceDeps {
  /** Resolves the current satellite list (curated tracked set). */
  listSatellites: () => Promise<Satellite[]>;
  /** Orbital propagation, used to derive position + eclipse state. */
  orbit: OrbitService;
}

/** Public surface of the telemetry service. */
export interface TelemetryService {
  /**
   * Generate one telemetry sample per tracked satellite at the given instant.
   *
   * @param now - Instant to evaluate. Defaults to `new Date()`.
   * @returns One {@link Telemetry} per satellite, in the same order as `listSatellites()`.
   */
  sample(now?: Date): Promise<Telemetry[]>;
}

/**
 * Build a stateful telemetry service. Holds per-satellite attitude state so
 * the random walk integrates across calls; reset by recreating the service.
 *
 * @example
 * ```ts
 * const telemetry = createTelemetryService({
 *   listSatellites: () => satelliteService.list(),
 *   orbit: orbitService,
 * });
 * setInterval(async () => {
 *   const samples = await telemetry.sample();
 *   // samples[i].voltage, .temperature, .attitude, .timestamp
 * }, 1000);
 * ```
 */
/**
 * Persistent fault latched onto one satellite. Real spacecraft faults don't
 * recover in 1 s — once triggered, the offending metric stays out of nominal
 * for several ticks. This also matches the anomaly engine's 3-consecutive
 * debounce: a single-sample blip would never trip an alert.
 */
interface ActiveFault {
  metric: 'voltage' | 'temperature';
  /** Signed offset (V or °C) applied to the nominal reading. */
  offset: number;
  /** Samples remaining before the fault clears. */
  remaining: number;
}

export function createTelemetryService(deps: TelemetryServiceDeps): TelemetryService {
  const attitudeState = new Map<number, Attitude>();
  const faults = new Map<number, ActiveFault>();

  return {
    async sample(now = new Date()) {
      const satellites = await deps.listSatellites();
      return satellites.map((sat) => sampleOne(sat, now, deps.orbit, attitudeState, faults));
    },
  };
}

/** Generate one sample for one satellite at one instant. */
function sampleOne(
  sat: Satellite,
  now: Date,
  orbit: OrbitService,
  attitudeState: Map<number, Attitude>,
  faults: Map<number, ActiveFault>,
): Telemetry {
  const position = orbit.positionAt(sat, now);
  const inEclipse = isInEclipse(position.lat, position.lon, position.alt, now);
  const phase = orbitalPhase(position.lat);

  let voltage = busVoltage(inEclipse);
  let temperature = internalTemperature(phase);
  const attitude = stepAttitude(attitudeState.get(sat.noradId));
  attitudeState.set(sat.noradId, attitude);

  const fault = nextFaultState(faults, sat.noradId);
  if (fault) {
    if (fault.metric === 'voltage') voltage += fault.offset;
    else temperature += fault.offset;
  }

  return {
    satelliteId: sat.noradId,
    voltage,
    temperature,
    attitude,
    timestamp: now.toISOString(),
  };
}

/**
 * Advance the fault state machine for one satellite by one tick.
 *
 * - If a fault is already active, return it and decrement its lifetime.
 * - If none is active, roll the {@link ANOMALY_PROB} dice to start one.
 *
 * The latched offset is applied to the same metric every tick of the fault's
 * lifetime, which is what lets the anomaly engine's 3-consecutive-sample
 * debounce actually trip.
 */
function nextFaultState(faults: Map<number, ActiveFault>, satelliteId: number): ActiveFault | null {
  const existing = faults.get(satelliteId);
  if (existing) {
    if (existing.remaining > 1) {
      faults.set(satelliteId, { ...existing, remaining: existing.remaining - 1 });
    } else {
      faults.delete(satelliteId);
    }
    return existing;
  }
  if (Math.random() >= ANOMALY_PROB) return null;
  const fault: ActiveFault =
    Math.random() < 0.5
      ? { metric: 'temperature', offset: 18, remaining: FAULT_DURATION_SAMPLES }
      : { metric: 'voltage', offset: -6, remaining: FAULT_DURATION_SAMPLES };
  faults.set(satelliteId, fault);
  return fault;
}

/**
 * Approximate eclipse check.
 *
 * Computes the sub-solar point on Earth's surface and the angular distance
 * from the satellite's sub-point to it. If that distance exceeds 90° plus the
 * horizon angle for the satellite's altitude, Earth occludes the Sun.
 *
 * @param latDeg - Satellite sub-point latitude in degrees.
 * @param lonDeg - Satellite sub-point longitude in degrees.
 * @param altKm  - Satellite altitude in kilometres above the geoid.
 * @param now    - UTC instant.
 * @returns `true` when the satellite is in Earth's umbral shadow.
 */
function isInEclipse(latDeg: number, lonDeg: number, altKm: number, now: Date): boolean {
  const { lat: subSolarLat, lon: subSolarLon } = subSolarPoint(now);
  const sep = angularSeparationDeg(latDeg, lonDeg, subSolarLat, subSolarLon);
  // Half-angle of the cone of sunlight the satellite can still see past the limb.
  const horizonHalfAngleDeg =
    (Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altKm)) * 180) / Math.PI;
  return sep > 90 + horizonHalfAngleDeg;
}

/**
 * Sub-solar point (lat, lon) at UTC `now`. Low-order approximation:
 *   - declination = obliquity · sin(2π · dayOfYear / 365.25)
 *   - hour angle  = (UT hours − 12) · 15°  (longitude where the Sun is overhead)
 *
 * Off by up to a couple of degrees vs. the true sub-solar point. Plenty for
 * deciding "is this satellite roughly in the dark hemisphere right now."
 */
function subSolarPoint(now: Date): { lat: number; lon: number } {
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const dayOfYear = (now.getTime() - startOfYear) / 86_400_000;
  // Spring equinox lands near day 80; offsetting keeps the sign correct.
  const declRad =
    ((OBLIQUITY_DEG * Math.PI) / 180) * Math.sin((2 * Math.PI * (dayOfYear - 80)) / 365.25);
  const utHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const lon = (((12 - utHours) * 15 + 540) % 360) - 180;
  return { lat: (declRad * 180) / Math.PI, lon };
}

/** Great-circle separation between two (lat, lon) points in degrees. */
function angularSeparationDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const cosSep = Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (Math.acos(Math.max(-1, Math.min(1, cosSep))) * 180) / Math.PI;
}

/**
 * Map sub-point latitude to a [0, 2π) orbital-phase proxy for the thermal
 * cycle. Real thermal cycling is driven by sunlit/shadow alternation; for a
 * demo, latitude does a decent job of producing a sinusoidal swing.
 */
function orbitalPhase(latDeg: number): number {
  return ((latDeg + 90) / 180) * 2 * Math.PI;
}

/**
 * Voltage model: nominal with ±2 V jitter, dropping by VOLTAGE_ECLIPSE_DROP
 * during eclipse passes.
 */
function busVoltage(inEclipse: boolean): number {
  const base = inEclipse ? VOLTAGE_NOMINAL - VOLTAGE_ECLIPSE_DROP : VOLTAGE_NOMINAL;
  return base + (Math.random() - 0.5) * 4;
}

/**
 * Temperature model: a sinusoid spanning TEMP_SWING_C centred on
 * TEMP_MEAN_C plus small white noise.
 */
function internalTemperature(phase: number): number {
  const swing = (TEMP_SWING_C / 2) * Math.sin(phase);
  const noise = (Math.random() - 0.5) * 3;
  return TEMP_MEAN_C + swing + noise;
}

/**
 * Per-axis random walk with a soft pull-back toward zero so attitude doesn't
 * drift unbounded. Each axis steps by a Gaussian-ish increment scaled by
 * ATTITUDE_STEP_DEG.
 */
function stepAttitude(prev?: Attitude): Attitude {
  const base = prev ?? { pitch: 0, roll: 0, yaw: 0 };
  return {
    pitch: walk(base.pitch),
    roll: walk(base.roll),
    yaw: walk(base.yaw),
  };
}

function walk(prev: number): number {
  const step = (Math.random() - 0.5) * 2 * ATTITUDE_STEP_DEG;
  // Soft pull-back: pulls harder the further we are from zero.
  const restoring = -prev * 0.02;
  const next = prev + step + restoring;
  if (next > ATTITUDE_CAP_DEG) return ATTITUDE_CAP_DEG;
  if (next < -ATTITUDE_CAP_DEG) return -ATTITUDE_CAP_DEG;
  return next;
}
