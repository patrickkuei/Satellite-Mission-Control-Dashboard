/**
 * AlertLog — bottom-panel feed of anomaly detections.
 *
 * Presentational only. Newest entry on top; severity drives the left-edge
 * accent colour. Satellite names are joined in at the call site so this
 * component stays free of the satellite map.
 */
import { memo, useMemo, useState, useRef, useCallback } from 'react';
import type { Anomaly } from '@orbit-ctrl/types';
import styles from './AlertLog.module.css';

/** Height bounds for the resizable log panel (px). */
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 400;
const DEFAULT_HEIGHT = 160;

/** Filter mode for the alert log. */
type Scope = 'all' | 'selected';

export interface AlertLogProps {
  /** Newest-first list of anomalies (already capped by the hook). */
  alerts: Anomaly[];
  /** NORAD ID → human-readable satellite name. */
  nameById: Map<number, string>;
  /** NORAD ID of the currently selected satellite, or null. Drives "Selected" filter. */
  selectedId: number | null;
}

/**
 * Render the alert log.
 *
 * @example
 * ```tsx
 * <AlertLog alerts={alerts} nameById={new Map(satellites.map(s => [s.noradId, s.name]))} />
 * ```
 */
export function AlertLog({ alerts, nameById, selectedId }: AlertLogProps): JSX.Element {
  const [scope, setScope] = useState<Scope>('all');
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragStartY = useRef<number | null>(null);
  const dragStartHeight = useRef(DEFAULT_HEIGHT);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      dragStartY.current = e.clientY;
      dragStartHeight.current = height;

      const onMove = (ev: MouseEvent) => {
        if (dragStartY.current === null) return;
        // Dragging up (negative delta) increases height since log is at the bottom.
        const delta = dragStartY.current - ev.clientY;
        const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragStartHeight.current + delta));
        setHeight(next);
      };

      const onUp = () => {
        dragStartY.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [height],
  );

  const visible = useMemo(() => {
    if (scope === 'selected' && selectedId !== null) {
      return alerts.filter((a) => a.satelliteId === selectedId);
    }
    return alerts;
  }, [alerts, scope, selectedId]);

  const selectedDisabled = selectedId === null;

  return (
    <section className={styles.log} style={{ height }} aria-label="Anomaly log">
      <div className={styles.dragHandle} onMouseDown={onDragStart} aria-hidden="true" />
      <header className={styles.header}>
        <span className={styles.title}>Alerts</span>
        <div className={styles.controls}>
          <button
            type="button"
            className={`${styles.toggle} ${scope === 'all' ? styles.active : ''}`}
            onClick={() => setScope('all')}
          >
            All
          </button>
          <button
            type="button"
            className={`${styles.toggle} ${scope === 'selected' ? styles.active : ''}`}
            onClick={() => setScope('selected')}
            disabled={selectedDisabled}
            title={
              selectedDisabled ? 'Select a satellite to filter' : 'Show only selected satellite'
            }
          >
            Selected
          </button>
          <span className={styles.count}>{visible.length}</span>
        </div>
      </header>
      {visible.length === 0 ? (
        <p className={styles.empty}>
          {scope === 'selected' ? 'No anomalies for selected satellite.' : 'No anomalies detected.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {visible.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              satelliteName={nameById.get(a.satelliteId) ?? `NORAD ${a.satelliteId}`}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface AlertRowProps {
  alert: Anomaly;
  /** Resolved once in the parent so this component stays free of the nameById Map. */
  satelliteName: string;
}

/**
 * One anomaly row. Memoized so dragging the resize handle — which re-renders
 * {@link AlertLog} on every `mousemove` tick — doesn't re-render every row in
 * the list each time; `alert` and `satelliteName` are stable across a resize
 * since {@link AlertLog}'s `visible` list isn't recomputed from `height`.
 */
const AlertRow = memo(function AlertRow({ alert, satelliteName }: AlertRowProps): JSX.Element {
  return (
    <li className={`${styles.row} ${styles[alert.severity]}`}>
      <span
        className={`${styles.chip} ${alert.severity === 'alert' ? styles.chip_alert : styles.chip_warn}`}
      >
        {alert.severity === 'alert' ? 'ALRT' : 'WARN'}
      </span>
      <span className={styles.time}>{formatTime(alert.timestamp)}</span>
      <span className={styles.sat}>{satelliteName}</span>
      <span className={styles.desc}>{alert.description}</span>
      <span className={styles.zscore}>Z {alert.zscore.toFixed(1)}</span>
    </li>
  );
});

/** Short UTC clock — matches the design's mono-monochrome time style. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}Z`;
}
