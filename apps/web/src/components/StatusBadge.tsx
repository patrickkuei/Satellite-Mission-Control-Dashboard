/**
 * StatusBadge — presentational component that renders the API's reported
 * health. Demonstrates the component contract: takes data via props, holds
 * no state, performs no I/O.
 */
import styles from './StatusBadge.module.css';

/** Props for {@link StatusBadge}. */
export interface StatusBadgeProps {
  /** Current API status; `null` while the first health check is pending. */
  status: 'ok' | 'degraded' | 'offline' | null;
}

/**
 * Visual indicator for the API connection state, shown in the header.
 *
 * @example
 * ```tsx
 * <StatusBadge status="ok" />
 * ```
 */
export default function StatusBadge({ status }: StatusBadgeProps): JSX.Element {
  const label = status === null ? 'checking…' : status === 'ok' ? 'nominal' : status;
  const dotClass =
    status === 'ok' ? styles.dotOk : status === 'offline' ? styles.dotOffline : styles.dotWarn;

  return (
    <span className={styles.badge}>
      <span className={dotClass} aria-hidden />
      {label}
    </span>
  );
}
