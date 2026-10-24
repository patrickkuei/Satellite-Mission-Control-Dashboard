/**
 * usePageActive — is someone actually looking at this tab?
 *
 * Used to gate the telemetry WebSocket. The stream costs ~5 KB/s per open tab
 * on the hosted API, and before this hook a forgotten background tab streamed
 * forever. The tab counts as inactive when either:
 *   - it has been hidden (`document.visibilityState === 'hidden'`) for longer
 *     than {@link HIDDEN_GRACE_MS}. The grace period keeps a quick alt-tab
 *     from closing and reopening the socket.
 *   - there has been no pointer / keyboard / wheel / touch input for
 *     {@link IDLE_TIMEOUT_MS}. This covers a visible tab left open on a second
 *     monitor overnight.
 *
 * Any input or the tab becoming visible again makes it active immediately.
 */
import { useEffect, useRef, useState } from 'react';

/** Hidden time allowed before the tab counts as inactive (ms). */
const HIDDEN_GRACE_MS = 15_000;
/** Time without input before a visible tab counts as idle (ms). */
const IDLE_TIMEOUT_MS = 30 * 60_000;
/** How often the idle deadline is checked (ms). Coarse on purpose; precision doesn't matter here. */
const IDLE_CHECK_MS = 30_000;
/** Input events that count as user activity. */
const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Track whether the current tab is visible and recently used.
 *
 * @returns `true` while the tab is visible (or hidden for less than the grace
 *   period) and has seen input in the last 30 minutes; otherwise `false`.
 *
 * @example
 * ```ts
 * const active = usePageActive();
 * useEffect(() => {
 *   if (!active) return; // don't open the socket
 *   const ws = new WebSocket(url);
 *   return () => ws.close();
 * }, [active]);
 * ```
 */
export function usePageActive(): boolean {
  const [hidden, setHidden] = useState(false);
  const [idle, setIdle] = useState(false);
  // Last input time lives in a ref: pointermove fires constantly and must not
  // re-render. State only changes when idle flips.
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    let hideTimer: number | null = null;

    function clearHideTimer(): void {
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      hideTimer = null;
    }

    function onVisibilityChange(): void {
      clearHideTimer();
      if (document.visibilityState === 'hidden') {
        hideTimer = window.setTimeout(() => setHidden(true), HIDDEN_GRACE_MS);
      } else {
        setHidden(false);
        markActive();
      }
    }

    function markActive(): void {
      lastActivityRef.current = Date.now();
      setIdle(false); // no-op re-render when already false
    }

    const idleCheck = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) setIdle(true);
    }, IDLE_CHECK_MS);

    document.addEventListener('visibilitychange', onVisibilityChange);
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, markActive, { passive: true });

    return () => {
      clearHideTimer();
      window.clearInterval(idleCheck);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, markActive);
    };
  }, []);

  return !hidden && !idle;
}
