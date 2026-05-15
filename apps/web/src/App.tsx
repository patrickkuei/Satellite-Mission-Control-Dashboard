/**
 * Root component — layout composition only.
 *
 * Phase 2 layout: header strip on top (status + live space weather), globe
 * filling the centre, selected-satellite rail on the right with the live
 * detail card + upcoming passes over the user's observer location. All data
 * flow lives in hooks; this file only wires them to presentational components.
 */
import { useMemo, useState } from 'react';
import StatusBadge from './components/StatusBadge';
import { SpaceWeatherBadge } from './components/SpaceWeatherBadge';
import { Globe, type SatelliteWithPosition } from './components/Globe';
import { SatelliteDetail } from './components/SatelliteDetail';
import { TelemetryStrip } from './components/TelemetryStrip';
import { AlertLog } from './components/AlertLog';
import { AgentChatPanel } from './components/AgentChatPanel';
import { useApiHealth } from './hooks/useApiHealth';
import { useSatellites } from './hooks/useSatellites';
import { useSatellitePositions } from './hooks/useSatellitePositions';
import { useGroundTrack } from './hooks/useGroundTrack';
import { useSpaceWeather } from './hooks/useSpaceWeather';
import { usePasses } from './hooks/usePasses';
import { useTelemetryStream } from './hooks/useTelemetryStream';
import { useSelectedSatellite } from './stores/selectedSatellite';
import { useObserverLocation } from './stores/observerLocation';
import styles from './App.module.css';

export function App(): JSX.Element {
  const { data: health, error: healthError } = useApiHealth();
  const { data: satellites = [] } = useSatellites();
  const { data: positions = [] } = useSatellitePositions();
  const { data: weather } = useSpaceWeather();
  const selectedId = useSelectedSatellite((s) => s.selectedId);
  const setSelected = useSelectedSatellite((s) => s.setSelected);
  const observer = useObserverLocation((s) => s.location);
  const { data: groundTrack } = useGroundTrack(selectedId);
  const { data: passes = [], isFetching: passesLoading } = usePasses(selectedId, observer);
  const { latestById, historyById, alerts } = useTelemetryStream();
  const [chatOpen, setChatOpen] = useState(false);

  // Join satellites + positions into the shape Globe expects.
  const pairs = useMemo<SatelliteWithPosition[]>(
    () => zipByIndex(satellites, positions),
    [satellites, positions],
  );

  const selectedPair = useMemo(
    () => pairs.find((p) => p.satellite.noradId === selectedId) ?? null,
    [pairs, selectedId],
  );

  const nameById = useMemo(() => new Map(satellites.map((s) => [s.noradId, s.name])), [satellites]);

  const selectedSample = selectedId !== null ? (latestById.get(selectedId) ?? null) : null;
  const selectedHistory = selectedId !== null ? (historyById.get(selectedId) ?? []) : [];

  const status = healthError ? 'offline' : (health?.status ?? null);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>orbit.ctrl</span>
        <span className={styles.center}>
          tracking <strong>{pairs.length}</strong> satellites · phase 4
        </span>
        <span className={styles.headerRight}>
          <SpaceWeatherBadge weather={weather ?? null} />
          <button
            type="button"
            className={styles.chatToggle}
            onClick={() => setChatOpen((open) => !open)}
            aria-pressed={chatOpen}
          >
            {chatOpen ? '◂ assistant' : 'assistant ▸'}
          </button>
          <StatusBadge status={status} />
        </span>
      </header>
      <section className={styles.stage}>
        <Globe
          satellites={pairs}
          groundTrack={groundTrack ?? null}
          selectedId={selectedId}
          onSelect={setSelected}
          observer={observer}
          kpIndex={weather?.kpIndex ?? null}
        />
        <SatelliteDetail
          data={selectedPair}
          passes={passes}
          observer={observer}
          passesLoading={passesLoading}
        />
      </section>
      <TelemetryStrip sample={selectedSample} history={selectedHistory} />
      <AlertLog alerts={alerts} nameById={nameById} selectedId={selectedId} />
      <AgentChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
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
