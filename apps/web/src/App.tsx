/**
 * Root component — layout composition only.
 *
 * Phase 2 layout: header strip on top (status + live space weather), globe
 * filling the centre, selected-satellite rail on the right with the live
 * detail card + upcoming passes over the user's observer location. All data
 * flow lives in hooks; this file only wires them to presentational components.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import StatusBadge from './components/StatusBadge';
import { SpaceWeatherBadge } from './components/SpaceWeatherBadge';
import type { SatelliteWithPosition } from './components/Globe';
import { GlobeSkeleton } from './components/GlobeSkeleton';
import { SatelliteDetail } from './components/SatelliteDetail';
import { TelemetryStrip } from './components/TelemetryStrip';
import { AlertLog } from './components/AlertLog';
import { AgentChatPanel } from './components/AgentChatPanel';
import { StatusConsole } from './components/StatusConsole';
import { Toasts } from './components/Toasts';
import { useApiHealth } from './hooks/useApiHealth';
import { useSatellites } from './hooks/useSatellites';
import { useServerHealth } from './hooks/useServerHealth';
import { useSatellitePositions } from './hooks/useSatellitePositions';
import { useGroundTrack } from './hooks/useGroundTrack';
import { useSpaceWeather } from './hooks/useSpaceWeather';
import { usePasses } from './hooks/usePasses';
import { useTelemetryStream } from './hooks/useTelemetryStream';
import { useUtcClock } from './hooks/useUtcClock';
import { useSelectedSatellite } from './stores/selectedSatellite';
import { useObserverLocation } from './stores/observerLocation';
import { useSystemStatus } from './stores/systemStatus';
import styles from './App.module.css';

// Lazy-load the Globe so Three.js (~1 MB) doesn't block the initial paint.
const Globe = lazy(() => import('./components/Globe').then((m) => ({ default: m.Globe })));

export function App(): JSX.Element {
  const { data: health, error: healthError } = useApiHealth();
  const {
    data: satellitesResult,
    isPending: satellitesPending,
    refetch: refetchSatellites,
  } = useSatellites();
  const { serverDown } = useServerHealth();
  const { setServerDown, setSatellitesStale } = useSystemStatus();

  const satellites = satellitesResult?.satellites ?? [];
  const { data: positions = [] } = useSatellitePositions();
  const { data: weather } = useSpaceWeather();
  const selectedId = useSelectedSatellite((s) => s.selectedId);
  const setSelected = useSelectedSatellite((s) => s.setSelected);
  const observer = useObserverLocation((s) => s.location);
  const { data: groundTrack } = useGroundTrack(selectedId);
  const { data: passes = [], isFetching: passesLoading } = usePasses(selectedId, observer);
  const { latestById, historyById, alerts, state: wsState } = useTelemetryStream();
  const [chatOpen, setChatOpen] = useState(false);
  const utcTime = useUtcClock();

  // Sync health + satellite staleness into the system status store.
  useEffect(() => {
    setServerDown(serverDown);
  }, [serverDown, setServerDown]);
  useEffect(() => {
    setSatellitesStale(satellitesResult?.stale ?? false, satellitesResult?.fetchedAt);
  }, [satellitesResult?.stale, satellitesResult?.fetchedAt, setSatellitesStale]);

  // When server comes back up, trigger a fresh satellite fetch.
  useEffect(() => {
    if (!serverDown) void refetchSatellites();
  }, [serverDown, refetchSatellites]);

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
          LEO · <strong>{pairs.length > 0 ? pairs.length : satellitesPending ? '…' : '—'}</strong>{' '}
          objects tracked · {utcTime}
        </span>
        <span className={styles.headerRight}>
          <SpaceWeatherBadge weather={weather ?? null} />
          <button
            type="button"
            className={`${styles.chatToggle} ${!chatOpen ? styles.chatToggleGlow : ''}`}
            onClick={() => setChatOpen((open) => !open)}
            aria-pressed={chatOpen}
          >
            {chatOpen ? '◂ assistant' : 'assistant ▸'}
          </button>
          <StatusBadge status={status} />
        </span>
      </header>
      {wsState !== 'open' && !serverDown && (
        <div className={styles.reconnectBanner}>
          {wsState === 'connecting' ? 'reconnecting telemetry…' : 'telemetry offline'}
        </div>
      )}
      <section className={styles.stage}>
        <Suspense fallback={<GlobeSkeleton />}>
          <Globe
            satellites={pairs}
            groundTrack={groundTrack ?? null}
            selectedId={selectedId}
            onSelect={setSelected}
            observer={observer}
            kpIndex={weather?.kpIndex ?? null}
          />
        </Suspense>
        <StatusConsole wsState={wsState} />
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
      <Toasts />
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
