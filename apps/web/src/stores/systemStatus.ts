/**
 * useSystemStatus — cross-cutting system health state consumed by the
 * StatusConsole, AgentPanel, and toast suppression logic.
 *
 * Updated by App.tsx, which wires together useServerHealth and useSatellites.
 */
import { create } from 'zustand';

export interface SystemStatusState {
  /** True while the API server is not responding to /health. */
  serverDown: boolean;
  /** True while satellite data is coming from the static GH Pages snapshot. */
  satellitesStale: boolean;
  /** ISO 8601 timestamp of the snapshot; only set when satellitesStale is true. */
  staleDate: string | undefined;
  setServerDown(down: boolean): void;
  setSatellitesStale(stale: boolean, fetchedAt?: string): void;
}

export const useSystemStatus = create<SystemStatusState>((set) => ({
  serverDown: false,
  satellitesStale: false,
  staleDate: undefined,
  setServerDown: (down) => set({ serverDown: down }),
  setSatellitesStale: (stale, fetchedAt) =>
    set({ satellitesStale: stale, staleDate: stale ? fetchedAt : undefined }),
}));
