/**
 * Anomaly service — rolling-window Z-score detector.
 *
 * Each telemetry sample is appended to a per-satellite ring buffer of the
 * last {@link WINDOW_SIZE} samples. For each monitored metric we compute the
 * Z-score of the newest sample against the window's mean and standard
 * deviation. Crossing |Z| > 3 flags an `"alert"`; |Z| > 2 flags a `"warn"`.
 *
 * A 3-consecutive-sample debounce prevents single-sample noise from flapping
 * the alert log — the engine waits until the same metric has tripped the
 * threshold three samples in a row before emitting. The counter resets as
 * soon as the metric returns to nominal.
 */
import crypto from 'node:crypto';
import type { Anomaly, AnomalySeverity, Telemetry, TelemetryMetric } from '@orbit-ctrl/types';

/** Number of samples retained per satellite (1 minute at 1 Hz). */
const WINDOW_SIZE = 60;
/** Minimum samples before the engine starts evaluating Z-scores. */
const MIN_SAMPLES = 10;
/** Consecutive trips on the same metric before an anomaly is emitted. */
const DEBOUNCE_COUNT = 3;
/** |Z| threshold for an `"alert"`-severity anomaly. */
const ALERT_ZSCORE = 3;
/** |Z| threshold for a `"warn"`-severity anomaly. */
const WARN_ZSCORE = 2;
/**
 * Floor on the rolling standard deviation. Below this, telemetry is essentially
 * constant and Z-scores become numerically unstable — treat the metric as
 * "nominal" by skipping it. Tuned per metric so the noise floor matches the
 * simulator's natural jitter (≈2 V, ≈3 °C, ≈0.05° per-axis).
 */
const SIGMA_FLOOR: Record<TelemetryMetric, number> = {
  voltage: 0.5,
  temperature: 1.0,
  attitude: 0.02,
};

/** Internal per-satellite state — never escapes this module. */
interface PerSatelliteState {
  history: Telemetry[];
  /** Consecutive-trip count by metric, used for debouncing. */
  trips: Map<TelemetryMetric, number>;
}

/** Public surface of the anomaly engine. */
export interface AnomalyService {
  /**
   * Append `sample` to the satellite's history and return any new anomalies
   * surfaced by this sample (zero or one per metric).
   *
   * @example
   * ```ts
   * const engine = createAnomalyService();
   * const newAlerts = engine.evaluate(sample);
   * for (const a of newAlerts) socket.send(JSON.stringify({ type: 'alert', data: a }));
   * ```
   */
  evaluate(sample: Telemetry): Anomaly[];
}

/**
 * Build a stateful anomaly engine. State is the per-satellite rolling window
 * and debounce counters; reset by recreating the service.
 */
export function createAnomalyService(): AnomalyService {
  const states = new Map<number, PerSatelliteState>();

  function getState(satelliteId: number): PerSatelliteState {
    let state = states.get(satelliteId);
    if (!state) {
      state = { history: [], trips: new Map() };
      states.set(satelliteId, state);
    }
    return state;
  }

  return {
    evaluate(sample) {
      const state = getState(sample.satelliteId);
      state.history.push(sample);
      if (state.history.length > WINDOW_SIZE) state.history.shift();
      if (state.history.length < MIN_SAMPLES) return [];

      const out: Anomaly[] = [];
      for (const metric of METRICS) {
        const anomaly = evaluateMetric(sample, state, metric);
        if (anomaly) out.push(anomaly);
      }
      return out;
    },
  };
}

/** Ordered list of metrics evaluated each sample. */
const METRICS: readonly TelemetryMetric[] = ['voltage', 'temperature', 'attitude'];

/**
 * Evaluate one metric for one sample. Returns an anomaly only when the
 * metric has tripped its threshold for {@link DEBOUNCE_COUNT} samples in a
 * row; otherwise updates the trip counter and returns `null`.
 */
function evaluateMetric(
  sample: Telemetry,
  state: PerSatelliteState,
  metric: TelemetryMetric,
): Anomaly | null {
  const values = state.history.map((t) => extractValue(t, metric));
  const current = values[values.length - 1]!;
  const { mean, stddev } = meanAndStddev(values);

  if (stddev < SIGMA_FLOOR[metric]) {
    state.trips.set(metric, 0);
    return null;
  }

  const z = (current - mean) / stddev;
  const severity = severityFor(z);
  if (!severity) {
    state.trips.set(metric, 0);
    return null;
  }

  const count = (state.trips.get(metric) ?? 0) + 1;
  state.trips.set(metric, count);
  if (count < DEBOUNCE_COUNT) return null;

  // Reset after emitting so the next anomaly requires another full debounce.
  state.trips.set(metric, 0);
  return {
    id: crypto.randomUUID(),
    satelliteId: sample.satelliteId,
    metric,
    severity,
    zscore: roundTo(z, 2),
    timestamp: sample.timestamp,
    description: describe(metric, z, severity),
  };
}

/**
 * Extract a scalar for the Z-score from a telemetry sample. Attitude is
 * collapsed to magnitude — a single-axis deviation should still trigger.
 */
function extractValue(t: Telemetry, metric: TelemetryMetric): number {
  if (metric === 'voltage') return t.voltage;
  if (metric === 'temperature') return t.temperature;
  return Math.sqrt(t.attitude.pitch ** 2 + t.attitude.roll ** 2 + t.attitude.yaw ** 2);
}

function meanAndStddev(values: number[]): { mean: number; stddev: number } {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, stddev: Math.sqrt(variance) };
}

function severityFor(z: number): AnomalySeverity | null {
  const abs = Math.abs(z);
  if (abs > ALERT_ZSCORE) return 'alert';
  if (abs > WARN_ZSCORE) return 'warn';
  return null;
}

function describe(metric: TelemetryMetric, z: number, severity: AnomalySeverity): string {
  const direction = z > 0 ? 'spike' : 'drop';
  if (metric === 'attitude') {
    return `Attitude excursion (${severity}, Z=${roundTo(z, 1)})`;
  }
  const label = metric === 'voltage' ? 'Bus voltage' : 'Internal temperature';
  return `${label} ${direction} (${severity}, Z=${roundTo(z, 1)})`;
}

function roundTo(n: number, places: number): number {
  const m = 10 ** places;
  return Math.round(n * m) / m;
}
