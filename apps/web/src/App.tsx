/**
 * Root component — layout composition only.
 *
 * Phase 1 layout: header strip on top, globe filling the centre, selected-
 * satellite rail on the right. All data flow lives in hooks; this file only
 * wires them to presentational components.
 */
import { useMemo } from 'react';
import StatusBadge from './components/StatusBadge';
import { Globe, type SatelliteWithPosition } from './components/Globe';
import { SatelliteDetail } from './components/SatelliteDetail';
import { useApiHealth } from './hooks/useApiHealth';
import { useSatellites } from './hooks/useSatellites';
import { useSatellitePositions } from './hooks/useSatellitePositions';
import { useGroundTrack } from './hooks/useGroundTrack';
import { useSelectedSatellite } from './stores/selectedSatellite';
import styles from './App.module.css';

export function App(): JSX.Element {
  const { data: health, error: healthError } = useApiHealth();
  const { data: satellites = [] } = useSatellites();
  const { data: positions = [] } = useSatellitePositions();
  const selectedId = useSelectedSatellite((s) => s.selectedId);
  const setSelected = useSelectedSatellite((s) => s.setSelected);
  const { data: groundTrack } = useGroundTrack(selectedId);

  // Join satellites + positions into the shape Globe expects.
  const pairs = useMemo<SatelliteWithPosition[]>(
    () => zipByIndex(satellites, positions),
    [satellites, positions],
  );

  const selectedPair = useMemo(
    () => pairs.find((p) => p.satellite.noradId === selectedId) ?? null,
    [pairs, selectedId],
  );

  const status = healthError ? 'offline' : (health?.status ?? null);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>orbit.ctrl</span>
        <span className={styles.center}>
          tracking <strong>{pairs.length}</strong> satellites · phase 1
        </span>
        <StatusBadge status={status} />
      </header>
      <section className={styles.stage}>
        <Globe
          satellites={pairs}
          groundTrack={groundTrack ?? null}
          selectedId={selectedId}
          onSelect={setSelected}
        />
        <SatelliteDetail data={selectedPair} />
      </section>
    </main>
  );
}

/**
 * Pair satellites with their positions by array index. The backend returns
 * `/satellites` and `/satellites/positions` in the same order, so a positional
 * zip is correct and avoids an O(n) lookup per frame.
 */
function zipByIndex<S, P>(satellites: S[], positions: P[]): { satellite: S; position: P }[] {
  const n = Math.min(satellites.length, positions.length);
  const out: { satellite: S; position: P }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ satellite: satellites[i] as S, position: positions[i] as P });
  }
  return out;
}
