/**
 * useApiHealth — canonical example of a hook-driven data fetch.
 *
 * Pattern reference for all future hooks:
 * - Owns the entire lifecycle of one piece of state (fetch + retry + status)
 * - Components consume the returned object and stay presentational
 * - Replace the manual `useEffect` with TanStack Query's `useQuery` in Phase 1+
 *   once `@tanstack/react-query` is added; the public hook signature should
 *   stay the same.
 */
import { useEffect, useState } from 'react';
import { fetchHealth, type HealthReport } from '../api/health';

/** Snapshot of API health from the consumer's point of view. */
export interface UseApiHealthResult {
  /** Latest successful report, or `null` until the first fetch resolves. */
  data: HealthReport | null;
  /** True while the initial fetch (or a retry) is in flight. */
  isLoading: boolean;
  /** Error from the most recent fetch attempt, if any. */
  error: Error | null;
}

/**
 * Poll the backend `/health` endpoint at a fixed interval and expose the
 * latest report to a component.
 *
 * @param pollIntervalMs - Milliseconds between polls. Defaults to 5000.
 * @returns A {@link UseApiHealthResult} that re-renders on each successful poll.
 *
 * @example
 * ```tsx
 * function StatusBadge() {
 *   const { data, error } = useApiHealth();
 *   if (error) return <span>offline</span>;
 *   if (!data) return <span>checking…</span>;
 *   return <span>{data.status}</span>;
 * }
 * ```
 */
export function useApiHealth(pollIntervalMs = 5000): UseApiHealthResult {
  const [data, setData] = useState<HealthReport | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const report = await fetchHealth();
        if (cancelled) return;
        setData(report);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    const handle = window.setInterval(load, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [pollIntervalMs]);

  return { data, isLoading, error };
}
