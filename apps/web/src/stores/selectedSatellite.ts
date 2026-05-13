/**
 * Zustand store for the currently selected satellite (by NORAD ID).
 *
 * Cross-cutting UI state — globe selection, detail rail, ground-track query
 * all read from here. Kept deliberately small; one slice per concern.
 */
import { create } from 'zustand';

/** Public surface of the selected-satellite store. */
export interface SelectedSatelliteState {
  /** Currently selected NORAD ID, or `null` if nothing is selected. */
  selectedId: number | null;
  /** Set the selected satellite. Pass `null` to clear. */
  setSelected(id: number | null): void;
}

/**
 * Hook-style accessor for the store.
 *
 * @example
 * ```tsx
 * const selectedId = useSelectedSatellite((s) => s.selectedId);
 * const setSelected = useSelectedSatellite((s) => s.setSelected);
 * ```
 */
export const useSelectedSatellite = create<SelectedSatelliteState>((set) => ({
  selectedId: null,
  setSelected: (selectedId) => set({ selectedId }),
}));
