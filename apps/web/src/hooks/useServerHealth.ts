/**
 * useServerHealth — polls GET /health every 5 s while the API server is
 * unreachable, then stops once it responds. Used to gate service availability
 * and drive the mission-control status console.
 */
import { useEffect, useRef, useState } from 'react';
import { apiBase } from '../api/config';

const POLL_INTERVAL_MS = 5_000;

/** Hook return shape. */
export interface ServerHealth {
  /** True while the API server is not responding. */
  serverDown: boolean;
}

/**
 * Continuously checks server reachability by polling `/health`.
 *
 * - Starts polling immediately on mount.
 * - Stops polling once a successful response is received.
 * - If the server goes down after initial success, this hook does NOT restart
 *   polling — mid-session drops are surfaced via toasts and the WebSocket
 *   reconnect banner instead.
 *
 * @example
 * ```tsx
 * const { serverDown } = useServerHealth();
 * if (serverDown) return <p>Server starting…</p>;
 * ```
 */
export function useServerHealth(): ServerHealth {
  const [serverDown, setServerDown] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolvedRef = useRef(false);

  useEffect(() => {
    async function check(): Promise<void> {
      try {
        const res = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(4_000) });
        if (res.ok) {
          setServerDown(false);
          resolvedRef.current = true;
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        } else {
          setServerDown(true);
        }
      } catch {
        setServerDown(true);
      }
    }

    // Run immediately, then on interval until resolved.
    void check();
    intervalRef.current = setInterval(() => {
      if (!resolvedRef.current) void check();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, []);

  return { serverDown };
}
