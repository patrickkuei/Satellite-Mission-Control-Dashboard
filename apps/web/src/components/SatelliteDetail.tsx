/**
 * SatelliteDetail — right-rail panel summarising the selected satellite.
 *
 * Presentational only. Receives a fully-resolved {@link SatelliteWithPosition}
 * or `null` (nothing selected). The parent decides what data to feed it.
 */
import type { SatelliteWithPosition } from './Globe';
import styles from './SatelliteDetail.module.css';

export interface SatelliteDetailProps {
  /** Selected satellite + its current position, or `null` for the empty state. */
  data: SatelliteWithPosition | null;
}

/** Render the detail card or a placeholder. */
export function SatelliteDetail({ data }: SatelliteDetailProps): JSX.Element {
  if (!data) {
    return (
      <aside className={styles.panel}>
        <p className={styles.empty}>Select a satellite to inspect it.</p>
      </aside>
    );
  }
  const { satellite, position } = data;
  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.name}>{satellite.name}</h2>
        <span className={styles.norad}>NORAD {satellite.noradId}</span>
      </header>
      <dl className={styles.metrics}>
        <Metric label="Altitude" value={`${position.alt.toFixed(1)} km`} />
        <Metric label="Velocity" value={`${position.velocity.toFixed(2)} km/s`} />
        <Metric label="Latitude" value={`${position.lat.toFixed(3)}°`} />
        <Metric label="Longitude" value={`${position.lon.toFixed(3)}°`} />
        <Metric label="Epoch" value={satellite.tle.epoch.slice(0, 19) + 'Z'} />
      </dl>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className={styles.metric}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{value}</dd>
    </div>
  );
}
