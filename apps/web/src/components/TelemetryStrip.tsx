/**
 * TelemetryStrip — horizontal row of metric cards for the selected satellite.
 *
 * Composes three {@link MetricCard}s (bus voltage, internal temperature,
 * attitude magnitude). Receives the latest sample and the rolling history
 * for sparklines; renders a placeholder when the selection has no telemetry
 * yet (cold-start or a satellite that just connected).
 */
import type { Telemetry } from '@orbit-ctrl/types';
import { MetricCard, type MetricStatus } from './MetricCard';
import styles from './TelemetryStrip.module.css';

/**
 * Voltage card thresholds. Tuned to sit a few volts below the simulator's
 * natural eclipse floor (≈22 V after jitter) so normal day/night transitions
 * don't flash red. Real anomalies dive much further on a brown-out fault.
 */
const VOLTAGE_WARN_LOW = 21;
const VOLTAGE_ALERT_LOW = 19;
/** Temperature thresholds (°C). Matches the simulator's natural swing tail. */
const TEMP_WARN_ABS = 40;
const TEMP_ALERT_ABS = 55;
/** Attitude magnitude thresholds (deg). */
const ATTITUDE_WARN = 1.0;
const ATTITUDE_ALERT = 1.4;

export interface TelemetryStripProps {
  /** Latest sample for the selected satellite, or null if none yet. */
  sample: Telemetry | null;
  /** Rolling history (oldest → newest) for sparklines. */
  history: Telemetry[];
}

/**
 * Render the strip. Designed to sit just above the alert log.
 *
 * @example
 * ```tsx
 * <TelemetryStrip sample={latestById.get(selectedId) ?? null} history={historyById.get(selectedId) ?? []} />
 * ```
 */
export function TelemetryStrip({ sample, history }: TelemetryStripProps): JSX.Element {
  if (!sample) {
    return (
      <div className={styles.strip}>
        <div className={styles.empty}>Awaiting telemetry…</div>
      </div>
    );
  }

  const voltagePoints = history.map((t) => t.voltage);
  const tempPoints = history.map((t) => t.temperature);
  const attitudePoints = history.map((t) => attitudeMagnitude(t));

  return (
    <div className={styles.strip}>
      <MetricCard
        label="Bus voltage"
        value={sample.voltage.toFixed(2)}
        unit="V"
        points={voltagePoints}
        status={voltageStatus(sample.voltage)}
      />
      <MetricCard
        label="Internal temp"
        value={sample.temperature.toFixed(1)}
        unit="°C"
        points={tempPoints}
        status={temperatureStatus(sample.temperature)}
      />
      <MetricCard
        label="Attitude |Δ|"
        value={attitudeMagnitude(sample).toFixed(2)}
        unit="°"
        points={attitudePoints}
        status={attitudeStatus(sample)}
      />
    </div>
  );
}

function attitudeMagnitude(t: Telemetry): number {
  return Math.sqrt(t.attitude.pitch ** 2 + t.attitude.roll ** 2 + t.attitude.yaw ** 2);
}

function voltageStatus(v: number): MetricStatus {
  if (v < VOLTAGE_ALERT_LOW) return 'alert';
  if (v < VOLTAGE_WARN_LOW) return 'warn';
  return 'nominal';
}

function temperatureStatus(t: number): MetricStatus {
  const abs = Math.abs(t);
  if (abs > TEMP_ALERT_ABS) return 'alert';
  if (abs > TEMP_WARN_ABS) return 'warn';
  return 'nominal';
}

function attitudeStatus(t: Telemetry): MetricStatus {
  const mag = attitudeMagnitude(t);
  if (mag > ATTITUDE_ALERT) return 'alert';
  if (mag > ATTITUDE_WARN) return 'warn';
  return 'nominal';
}
