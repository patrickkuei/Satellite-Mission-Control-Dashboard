/**
 * Zustand store for the user's ground-observer location.
 *
 * Default is Tokyo (35.68° N, 139.69° E) — see docs/UI_DESIGN_SPEC.md. The
 * frontend can later prompt the browser for the real location via the
 * Geolocation API and call {@link ObserverLocationState.setLocation}.
 */
import { create } from 'zustand';
import type { ObserverLocation } from '@orbit-ctrl/types';

/** Public surface of the observer-location store. */
export interface ObserverLocationState {
  /** Current observer location. Always defined; never null. */
  location: ObserverLocation;
  /** Replace the location (e.g., from geolocation prompt or manual input). */
  setLocation(location: ObserverLocation): void;
}

/** Default observer location — Tokyo. */
export const DEFAULT_OBSERVER: ObserverLocation = {
  lat: 35.68,
  lon: 139.69,
};

/**
 * Hook-style accessor for the observer-location store.
 *
 * @example
 * ```tsx
 * const location = useObserverLocation((s) => s.location);
 * const passes = usePasses(selectedId, location, 24);
 * ```
 */
export const useObserverLocation = create<ObserverLocationState>((set) => ({
  location: DEFAULT_OBSERVER,
  setLocation: (location) => set({ location }),
}));
