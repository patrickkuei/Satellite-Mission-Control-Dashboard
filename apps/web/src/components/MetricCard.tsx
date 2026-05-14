/**
 * MetricCard — a single labelled telemetry value with an inline sparkline.
 *
 * Presentational only. Receives the current reading, a unit suffix, a status
 * tier that drives the colour, and a `points` array of recent numeric samples
 * that Recharts renders as a small unlabelled line.
 */
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import styles from './MetricCard.module.css';

/** Status tier — drives the value colour and the sparkline stroke. */
export type MetricStatus = 'nominal' | 'warn' | 'alert';

export interface MetricCardProps {
  /** Short label shown above the value (e.g. "Bus voltage"). */
  label: string;
  /** Formatted reading (already rounded to display precision). */
  value: string;
  /** Unit suffix shown after the value (e.g. "V"). */
  unit: string;
  /** Recent points for the sparkline, oldest → newest. */
  points: number[];
  /** Status tier; defaults to `nominal`. */
  status?: MetricStatus;
}

/**
 * Render one metric tile.
 *
 * @example
 * ```tsx
 * <MetricCard label="Bus voltage" value="28.12" unit="V" points={voltageWindow} />
 * ```
 */
export function MetricCard({
  label,
  value,
  unit,
  points,
  status = 'nominal',
}: MetricCardProps): JSX.Element {
  const data = points.map((y, i) => ({ i, y }));
  const stroke = strokeFor(status);
  return (
    <div className={`${styles.card} ${styles[status]}`}>
      <div className={styles.label}>{label}</div>
      <div className={styles.row}>
        <div className={styles.value}>
          {value}
          <span className={styles.unit}>{unit}</span>
        </div>
        <div className={styles.sparkline}>
          {data.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke={stroke}
                  strokeWidth={1.25}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Map status to a CSS-variable colour. Picked at render so tokens stay live. */
function strokeFor(status: MetricStatus): string {
  if (status === 'alert') return 'var(--color-danger)';
  if (status === 'warn') return 'var(--color-warning)';
  return 'var(--color-accent)';
}
