/**
 * Anomaly log — in-memory ring buffer of recently-emitted anomalies.
 *
 * The anomaly detector ({@link createAnomalyService}) is sample-driven and
 * stateless about what it has already reported. The agent's `get_anomalies`
 * tool needs *historical* alerts, so the telemetry tick appends every
 * detection here on emit, and the tool reads recent entries on demand.
 *
 * Capped at a few hundred entries — anomalies are rare in the simulator and
 * we never need to recall further back than the operator's session.
 */
import type { Anomaly } from '@orbit-ctrl/types';

/** Hard cap on retained entries. Older anomalies are dropped on append. */
const MAX_ENTRIES = 256;

/** Public surface of the anomaly log. */
export interface AnomalyLogService {
  /** Append an anomaly to the log, evicting the oldest if at capacity. */
  append(anomaly: Anomaly): void;
  /**
   * Return anomalies matching the filters, newest first.
   *
   * @param opts.satelliteId  - If set, only this satellite.
   * @param opts.sinceMinutes - Look-back window in minutes (default 30).
   * @example
   * ```ts
   * const recent = log.recent({ sinceMinutes: 10 });
   * ```
   */
  recent(opts?: { satelliteId?: number; sinceMinutes?: number }): Anomaly[];
}

/** Build a fresh in-memory anomaly log. */
export function createAnomalyLogService(): AnomalyLogService {
  const entries: Anomaly[] = [];

  return {
    append(anomaly) {
      entries.push(anomaly);
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    },
    recent(opts = {}) {
      const sinceMinutes = opts.sinceMinutes ?? 30;
      const cutoff = Date.now() - sinceMinutes * 60_000;
      const out = entries.filter(
        (a) =>
          Date.parse(a.timestamp) >= cutoff &&
          (opts.satelliteId === undefined || a.satelliteId === opts.satelliteId),
      );
      return out.reverse();
    },
  };
}
