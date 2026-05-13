/**
 * SpaceWeatherBadge — header-strip readout of the current geomagnetic state.
 *
 * Presentational only: parent passes a {@link SpaceWeather} snapshot or
 * `null` (loading). The badge surfaces the three metrics a mission-control
 * operator actually scans for at a glance: Kp index, NOAA summary, and the
 * top X-ray flare class.
 */
import type { SpaceWeather, WeatherSummary } from '@orbit-ctrl/types';
import styles from './SpaceWeatherBadge.module.css';

/** Props for {@link SpaceWeatherBadge}. */
export interface SpaceWeatherBadgeProps {
  /** Latest snapshot; `null` until the first fetch resolves. */
  weather: SpaceWeather | null;
}

function summaryClass(summary: WeatherSummary): string {
  switch (summary) {
    case 'quiet':
      return styles.summaryQuiet ?? '';
    case 'unsettled':
      return styles.summaryUnsettled ?? '';
    case 'active':
      return styles.summaryActive ?? '';
    case 'storm':
      return styles.summaryStorm ?? '';
  }
}

/**
 * Render the current space-weather summary in the header.
 *
 * @example
 * ```tsx
 * const { data } = useSpaceWeather();
 * <SpaceWeatherBadge weather={data ?? null} />
 * ```
 */
export function SpaceWeatherBadge({ weather }: SpaceWeatherBadgeProps): JSX.Element {
  if (!weather) {
    return <span className={styles.badge}>space weather · checking…</span>;
  }
  const flare = `${weather.xrayFlux.class}${weather.xrayFlux.magnitude.toFixed(1)}`;
  return (
    <span className={styles.badge} title={`fetched ${weather.fetchedAt.slice(11, 19)}Z`}>
      <span className={styles.kp}>
        <span className={styles.kpLabel}>Kp</span>
        <span className={styles.kpValue}>{weather.kpIndex.toFixed(1)}</span>
      </span>
      <span className={`${styles.summary} ${summaryClass(weather.summary)}`}>
        {weather.summary}
      </span>
      <span className={styles.flare}>flare {flare}</span>
    </span>
  );
}
