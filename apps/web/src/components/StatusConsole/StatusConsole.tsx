/**
 * StatusConsole — mission-control-style readout rendered in the bottom-right
 * corner of the globe panel.
 *
 * Shows a stacked list of service status lines while any service is degraded.
 * Each line transitions from amber (offline/degraded) to green (nominal) as
 * services recover. The entire block fades out 5 s after all lines go nominal,
 * and reappears if a service drops again after the server-down window closes.
 */
import { useEffect, useRef, useState } from 'react';
import { useSystemStatus } from '../../stores/systemStatus';
import styles from './StatusConsole.module.css';

/** Props from App — WebSocket state forwarded directly to avoid store coupling. */
export interface StatusConsoleProps {
  wsState: 'connecting' | 'open' | 'closed';
}

type LineStatus = 'offline' | 'nominal';

interface StatusLine {
  label: string;
  detail?: string;
  status: LineStatus;
}

/** How long (ms) to keep the console visible after all lines go nominal. */
const FADE_DELAY_MS = 5_000;

/**
 * @example
 * ```tsx
 * <StatusConsole wsState={wsState} />
 * ```
 */
export function StatusConsole({ wsState }: StatusConsoleProps): JSX.Element | null {
  const { serverDown, satellitesStale, staleDate } = useSystemStatus();
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lines: StatusLine[] = [
    {
      label: 'UPLINK',
      status: serverDown ? 'offline' : 'nominal',
      detail: serverDown ? 'NODE STARTING…' : 'NOMINAL',
    },
    {
      label: 'AGENT',
      status: serverDown ? 'offline' : 'nominal',
      detail: serverDown ? 'OFFLINE' : 'ONLINE',
    },
    {
      label: 'FEED',
      status: satellitesStale ? 'offline' : 'nominal',
      detail: satellitesStale ? `CACHE ${staleDate ? formatDate(staleDate) : '—'}` : 'LIVE',
    },
    {
      label: 'TELEMETRY',
      status: wsState !== 'open' ? 'offline' : 'nominal',
      detail:
        wsState === 'open' ? 'CONNECTED' : wsState === 'connecting' ? 'RECONNECTING…' : 'OFFLINE',
    },
  ];

  const allNominal = lines.every((l) => l.status === 'nominal');
  const anyDegraded = !allNominal;

  useEffect(() => {
    if (anyDegraded) {
      // Something is degraded — show immediately, cancel any pending fade.
      if (fadeTimerRef.current !== null) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      setFading(false);
      setVisible(true);
    } else if (visible) {
      // All nominal and currently visible — start fade-out countdown.
      setFading(true);
      fadeTimerRef.current = setTimeout(() => {
        setVisible(false);
        setFading(false);
        fadeTimerRef.current = null;
      }, FADE_DELAY_MS);
    }

    return () => {
      if (fadeTimerRef.current !== null) clearTimeout(fadeTimerRef.current);
    };
  }, [anyDegraded, visible]);

  if (!visible) return null;

  return (
    <div className={`${styles.console} ${fading ? styles.fading : ''}`} aria-live="polite">
      {lines.map((line) => (
        <div key={line.label} className={styles.line}>
          <span className={styles.label}>{line.label}</span>
          <span className={line.status === 'nominal' ? styles.nominal : styles.offline}>
            {line.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Format an ISO 8601 timestamp as `YYYY-MM-DD` for the console readout. */
function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
