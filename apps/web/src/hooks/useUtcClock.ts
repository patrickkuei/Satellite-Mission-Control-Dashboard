/**
 * useUtcClock — returns the current UTC time string, updated every second.
 *
 * Formatted as `HH:MM:SS UTC` to match the mission-control display aesthetic.
 */
import { useState, useEffect } from 'react';

function toUtcString(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} UTC`;
}

/**
 * @returns Live UTC time string, e.g. `"14:23:07 UTC"`, ticking every second.
 *
 * @example
 * ```tsx
 * const time = useUtcClock();
 * return <span>{time}</span>; // "14:23:07 UTC"
 * ```
 */
export function useUtcClock(): string {
  const [time, setTime] = useState(() => toUtcString(new Date()));

  useEffect(() => {
    const id = window.setInterval(() => setTime(toUtcString(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);

  return time;
}
