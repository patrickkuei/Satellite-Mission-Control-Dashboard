/**
 * SatelliteDetail — right-rail panel summarising the selected satellite and
 * its upcoming passes over the user's observer location.
 *
 * Presentational only. Receives the satellite pairing, the list of predicted
 * passes, and the observer that produced them. Hooks own all data fetching.
 */
import type { ObserverLocation, Pass } from '@orbit-ctrl/types';
import type { SatelliteWithPosition } from './Globe';
import styles from './SatelliteDetail.module.css';

/** Props for {@link SatelliteDetail}. */
export interface SatelliteDetailProps {
  /** Selected satellite + its current position, or `null` for the empty state. */
  data: SatelliteWithPosition | null;
  /** Upcoming passes over the observer; empty array when no visibility predicted. */
  passes: Pass[];
  /** Observer location used to compute `passes` — shown in the panel header. */
  observer: ObserverLocation;
  /** True while the passes query is in flight (shows a small loading hint). */
  passesLoading: boolean;
}

/** Render the detail card or a placeholder when nothing is selected. */
export function SatelliteDetail({
  data,
  passes,
  observer,
  passesLoading,
}: SatelliteDetailProps): JSX.Element {
  if (!data) {
    return (
      <aside className={styles.panel}>
        <p className={styles.empty}>Select a satellite to inspect it.</p>
      </aside>
    );
  }
  const { satellite, position } = data;
  const nextPass = passes[0];
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
        <Metric label="Next pass" value={nextPass ? formatNextPass(nextPass) : '—'} />
      </dl>
      <section className={styles.passes}>
        <h3 className={styles.passesTitle}>
          Passes <span className={styles.observer}>over {formatObserver(observer)}</span>
        </h3>
        <PassList passes={passes} loading={passesLoading} />
      </section>
    </aside>
  );
}

function PassList({ passes, loading }: { passes: Pass[]; loading: boolean }): JSX.Element {
  if (loading && passes.length === 0) {
    return <p className={styles.passesEmpty}>computing passes…</p>;
  }
  if (passes.length === 0) {
    return <p className={styles.passesEmpty}>No passes in the next 24 h.</p>;
  }
  return (
    <ul className={styles.passList}>
      {passes.slice(0, 6).map((p) => (
        <li key={p.startTime} className={styles.passItem}>
          <span className={styles.passWhen}>{formatPassTime(p.startTime)}</span>
          <span className={styles.passDuration}>{formatDuration(p.durationSeconds)}</span>
          <span className={styles.passElev}>{p.maxElevationDeg.toFixed(0)}°</span>
        </li>
      ))}
    </ul>
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

/** Format the start of the next pass as "HH:MM UTC · Δ +1h23m". */
function formatNextPass(pass: Pass): string {
  const start = new Date(pass.startTime);
  const deltaMin = Math.max(0, Math.round((start.getTime() - Date.now()) / 60000));
  const hh = Math.floor(deltaMin / 60);
  const mm = deltaMin % 60;
  const eta = hh > 0 ? `+${hh}h${String(mm).padStart(2, '0')}m` : `+${mm}m`;
  return `${formatPassTime(pass.startTime)} · ${eta}`;
}

/** Pass-list row time — short UTC "DD HH:MM" so timezones don't lie. */
function formatPassTime(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${hh}:${mm}Z`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m${String(s).padStart(2, '0')}s`;
}

function formatObserver(observer: ObserverLocation): string {
  const lat = `${Math.abs(observer.lat).toFixed(2)}°${observer.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(observer.lon).toFixed(2)}°${observer.lon >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}
