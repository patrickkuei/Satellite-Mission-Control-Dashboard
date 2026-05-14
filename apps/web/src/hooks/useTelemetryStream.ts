/**
 * useTelemetryStream — subscribe to the `/ws/telemetry` WebSocket.
 *
 * Owns the WebSocket lifecycle: opens on mount, parses inbound frames against
 * `WSMessageSchema` (we don't trust the wire just because TS is happy), and
 * reconnects with exponential backoff after unintentional disconnects.
 *
 * Exposes three derived state slices:
 *   - `latestById`  — latest sample per NORAD ID (constant-time lookup for cards).
 *   - `historyById` — last {@link HISTORY_LEN} samples per NORAD ID (sparkline data).
 *   - `alerts`      — last {@link ALERT_LIMIT} anomalies, newest first.
 */
import { useEffect, useRef, useState } from 'react';
import { WSMessageSchema, type Anomaly, type Telemetry, type WSMessage } from '@orbit-ctrl/types';

/** Samples retained per satellite for sparkline rendering (~1 minute at 1 Hz). */
const HISTORY_LEN = 60;
/** Anomaly log capacity — older entries fall off the bottom of the panel. */
const ALERT_LIMIT = 25;
/** Backoff schedule (ms) used after the WS closes unexpectedly. */
const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

/**
 * Connection state surfaced to the UI. `connecting` covers both the initial
 * dial and any retry; `closed` is a terminal-ish state after backoff exhaust.
 */
export type ConnectionState = 'connecting' | 'open' | 'closed';

/** Public shape returned by {@link useTelemetryStream}. */
export interface TelemetryStream {
  /** Latest sample per satellite, keyed by NORAD ID. */
  latestById: Map<number, Telemetry>;
  /** Rolling history per satellite for sparklines (oldest → newest). */
  historyById: Map<number, Telemetry[]>;
  /** Newest-first list of recent anomalies, capped at {@link ALERT_LIMIT}. */
  alerts: Anomaly[];
  /** Live connection status — useful for showing a "reconnecting…" hint. */
  state: ConnectionState;
}

/**
 * Open the telemetry WebSocket and yield reactive slices of the stream.
 *
 * @example
 * ```tsx
 * const { latestById, historyById, alerts } = useTelemetryStream();
 * const sample = latestById.get(selectedId);
 * ```
 */
export function useTelemetryStream(): TelemetryStream {
  const [latestById, setLatestById] = useState<Map<number, Telemetry>>(() => new Map());
  const [historyById, setHistoryById] = useState<Map<number, Telemetry[]>>(() => new Map());
  const [alerts, setAlerts] = useState<Anomaly[]>([]);
  const [state, setState] = useState<ConnectionState>('connecting');

  // Refs survive React strict-mode double-invoke; the actual socket isn't
  // touched by render output so it shouldn't trigger re-renders either.
  const attemptRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Each effect activation captures its own `abandoned` flag in closure.
    // React 18 strict-mode in dev runs mount → cleanup → mount; the old
    // socket's close handler can fire AFTER the second mount has begun, so
    // a shared ref-based flag gets reset and the orphan socket triggers a
    // reconnect — leaving two parallel feeds and duplicate alert frames.
    // Per-activation closure makes the intent immutable for that lifetime.
    let abandoned = false;

    function applyTelemetry(samples: Telemetry[]): void {
      setLatestById((prev) => {
        const next = new Map(prev);
        for (const s of samples) next.set(s.satelliteId, s);
        return next;
      });
      setHistoryById((prev) => {
        const next = new Map(prev);
        for (const s of samples) {
          const existing = next.get(s.satelliteId) ?? [];
          const appended = [...existing, s];
          if (appended.length > HISTORY_LEN) appended.splice(0, appended.length - HISTORY_LEN);
          next.set(s.satelliteId, appended);
        }
        return next;
      });
    }

    function applyAlert(alert: Anomaly): void {
      setAlerts((prev) => {
        // Defense-in-depth: ignore re-deliveries of the same UUID. Should
        // never fire after the lifecycle fix below, but cheap insurance.
        if (prev.some((a) => a.id === alert.id)) return prev;
        return [alert, ...prev].slice(0, ALERT_LIMIT);
      });
    }

    function connect(): void {
      if (abandoned) return;
      setState('connecting');
      const url = `${wsProtocol()}//${window.location.host}/ws/telemetry`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        if (abandoned) return;
        attemptRef.current = 0;
        setState('open');
      });

      ws.addEventListener('message', (event) => {
        if (abandoned) return;
        const parsed = parseFrame(event.data);
        if (!parsed) return;
        if (parsed.type === 'telemetry') applyTelemetry(parsed.data);
        else if (parsed.type === 'alert') applyAlert(parsed.data);
      });

      ws.addEventListener('close', () => {
        if (abandoned) return; // this effect has been torn down
        if (wsRef.current === ws) wsRef.current = null;
        scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        // Close handler runs after error, so we only need to log here.
        if (!abandoned) console.warn('telemetry ws error');
      });
    }

    function scheduleReconnect(): void {
      if (abandoned) return;
      const attempt = attemptRef.current;
      if (attempt >= RECONNECT_BACKOFF_MS.length) {
        setState('closed');
        return;
      }
      const delay = RECONNECT_BACKOFF_MS[attempt]!;
      attemptRef.current = attempt + 1;
      setState('connecting');
      reconnectTimerRef.current = window.setTimeout(connect, delay);
    }

    connect();

    return () => {
      abandoned = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, []);

  return { latestById, historyById, alerts, state };
}

/** Choose `ws://` vs `wss://` based on the current page protocol. */
function wsProtocol(): string {
  return window.location.protocol === 'https:' ? 'wss:' : 'ws:';
}

/**
 * Parse + validate one inbound frame. Returns `null` on parse failure rather
 * than throwing, so a single malformed frame can't kill the subscription.
 */
function parseFrame(raw: unknown): WSMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = WSMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
