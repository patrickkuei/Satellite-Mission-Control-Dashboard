/**
 * Globe — 3D Earth visualisation rendering live satellite positions, the
 * selected satellite's forward ground track, the observer's ground station,
 * and a coarse auroral-oval overlay when geomagnetic activity is elevated.
 *
 * Presentational by contract: all data + callbacks arrive via props. State,
 * polling, and HTTP live in the hooks that compose this component.
 *
 * Altitudes from `satellite.js` are in kilometres; `react-globe.gl` wants
 * fractions of an Earth radius, so we divide by `EARTH_RADIUS_KM` before
 * handing them to the renderer.
 */
import { useMemo, useRef, useEffect, useState } from 'react';
import GlobeGL, { type GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import type { GroundTrack, ObserverLocation, Position, Satellite } from '@orbit-ctrl/types';
import styles from './Globe.module.css';

/** Mean Earth radius in km — used to normalise altitude for the renderer. */
const EARTH_RADIUS_KM = 6371;
/** Hex colour of the amber accent — design-token equivalent for Three.js objects. */
const ACCENT_COLOR = 0xff6b35;
/** Selected-satellite highlight colour (success green). */
const SELECTED_COLOR = 0x4ade80;
/** Observer marker colour — warm white so it reads on both day and night maps. */
const OBSERVER_COLOR = 0xfafafa;
/** Latitude band sampling step for the auroral oval. */
const AURORA_STEP_DEG = 6;
/** Kp at which the oval first lights up. Below this the overlay is hidden. */
const AURORA_KP_THRESHOLD = 3;

/** A satellite paired with its current propagated position. */
export interface SatelliteWithPosition {
  satellite: Satellite;
  position: Position;
}

/** Props for {@link Globe}. */
export interface GlobeProps {
  /** Satellites + their current positions to render as points. */
  satellites: SatelliteWithPosition[];
  /** Optional forward ground track of the currently selected satellite. */
  groundTrack?: GroundTrack | null;
  /** Currently selected NORAD ID; rendered in the highlight colour. */
  selectedId: number | null;
  /** Called when the user clicks a satellite point. Passes null to deselect. */
  onSelect(noradId: number | null): void;
  /** User's ground-station location — rendered as a marker. */
  observer: ObserverLocation;
  /**
   * Current planetary K-index. When ≥ {@link AURORA_KP_THRESHOLD} the auroral
   * oval is drawn around each geographic pole, scaled by Kp. `null` while the
   * first space-weather fetch is pending — overlay stays hidden.
   */
  kpIndex: number | null;
}

/**
 * Render Earth + tracked satellites. The component is intentionally narrow:
 * it doesn't fetch, poll, or own selection state — it only paints.
 */
export function Globe({
  satellites,
  groundTrack,
  selectedId,
  onSelect,
  observer,
  kpIndex,
}: GlobeProps): JSX.Element {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // ── Auto-rotate the globe on mount for a bit of "alive" feel. ───────────
  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
  }, []);

  // Pause rotation while the cursor is over the globe so users can aim at
  // a satellite without it drifting away under their mouse.
  const handleMouseEnter = () => {
    const controls = globeRef.current?.controls();
    if (controls) controls.autoRotate = false;
  };
  const handleMouseLeave = () => {
    const controls = globeRef.current?.controls();
    if (controls) controls.autoRotate = true;
  };

  // Animate camera back to a north-up view centred on the observer location.
  const handleHome = () => {
    globeRef.current?.pointOfView({ lat: observer.lat, lng: observer.lon, altitude: 2.2 }, 800);
  };

  // react-globe.gl falls back to window.innerWidth/Height when width/height
  // props are missing — that ignores the flex sidebar and pushes content
  // off-screen. Observe the host element instead and feed back its real size.
  // Debounce 50 ms: satellite selection triggers a layout repaint that fires
  // the observer with a transient intermediate size, causing a visible canvas
  // flicker. The debounce collapses those rapid firings into one stable read.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let timer: number;
    const apply = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSize({ w: host.clientWidth, h: host.clientHeight }), 50);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(host);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  // Pre-compute the Three.js mesh factory so we don't rebuild a geometry
  // every frame — `react-globe.gl` re-invokes `objectThreeObject` per point.
  const buildMesh = useMemo(() => makeSatelliteMeshFactory(selectedId), [selectedId]);

  const groundPath = groundTrack ? [groundTrack.points] : [];
  const auroraPaths = useMemo(() => buildAuroraPaths(kpIndex), [kpIndex]);
  const pathsData = [...groundPath, ...auroraPaths];
  const auroraColor = `rgba(74, 222, 128, ${auroraOpacity(kpIndex ?? 0)})`;

  return (
    <div
      className={styles.host}
      ref={hostRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className={styles.homeBtn}
        onClick={handleHome}
        title="Reset view to observer location"
      >
        ⌂
      </button>
      <GlobeGL
        ref={globeRef}
        width={size.w}
        height={size.h}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundColor="rgba(0,0,0,0)"
        objectsData={satellites}
        objectLat={(d) => (d as SatelliteWithPosition).position.lat}
        objectLng={(d) => (d as SatelliteWithPosition).position.lon}
        objectAltitude={(d) => (d as SatelliteWithPosition).position.alt / EARTH_RADIUS_KM}
        objectLabel={(d) => formatLabel(d as SatelliteWithPosition)}
        objectThreeObject={(d) => buildMesh(d as SatelliteWithPosition)}
        onObjectClick={(d) => {
          const noradId = (d as SatelliteWithPosition).satellite.noradId;
          // Toggle: clicking the already-selected satellite deselects it.
          onSelect(noradId === selectedId ? null : noradId);
        }}
        pointsData={[observer]}
        pointLat={(d) => (d as ObserverLocation).lat}
        pointLng={(d) => (d as ObserverLocation).lon}
        pointAltitude={0.01}
        pointRadius={0.5}
        pointColor={() => `#${OBSERVER_COLOR.toString(16).padStart(6, '0')}`}
        pointLabel={(d) => formatObserverLabel(d as ObserverLocation)}
        pathsData={pathsData}
        pathPoints={(d) => d as Position[]}
        pathPointLat={(p) => (p as Position).lat}
        pathPointLng={(p) => (p as Position).lon}
        pathPointAlt={(p) => (p as Position).alt / EARTH_RADIUS_KM}
        pathColor={
          ((d: unknown) =>
            isAuroraPath(d as Position[])
              ? auroraColor
              : 'rgba(255, 107, 53, 0.45)') as () => string
        }
        pathStroke={((d: unknown) => (isAuroraPath(d as Position[]) ? 2.5 : 1.5)) as () => number}
        pathTransitionDuration={0}
      />
    </div>
  );
}

/**
 * Build a closure that returns a Three.js Group for a given satellite.
 *
 * Each group contains two spheres:
 *  - A small visible sphere (amber or green for selected).
 *  - A larger transparent sphere that acts as the click hit area, making
 *    satellites much easier to select on a rotating globe at typical zoom.
 *
 * Geometry and material objects are shared across all instances (created once
 * in the closure) — only the Mesh and Group wrappers are allocated per call.
 */
function makeSatelliteMeshFactory(
  selectedId: number | null,
): (sat: SatelliteWithPosition) => THREE.Object3D {
  const visGeometry = new THREE.SphereGeometry(0.6, 12, 12);
  const hitGeometry = new THREE.SphereGeometry(2.5, 6, 6);
  const baseMaterial = new THREE.MeshBasicMaterial({ color: ACCENT_COLOR });
  const selectedMaterial = new THREE.MeshBasicMaterial({ color: SELECTED_COLOR });
  // depthWrite false keeps the invisible sphere from occluding labels/paths.
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  return (sat) => {
    const visMat = sat.satellite.noradId === selectedId ? selectedMaterial : baseMaterial;
    const group = new THREE.Group();
    group.add(new THREE.Mesh(visGeometry, visMat));
    group.add(new THREE.Mesh(hitGeometry, hitMaterial));
    return group;
  };
}

/**
 * Build the auroral-oval overlay paths.
 *
 * Approximation: the equatorward boundary of visible aurora sits near
 * geomagnetic latitude ≈ 67° − 2·Kp. For a portfolio demo we ignore the
 * geomagnetic-vs-geographic offset and trace circles of constant geographic
 * latitude — close enough to read as "aurora over the high latitudes" without
 * pulling in a magnetic-field model.
 *
 * Returns the empty array when Kp is too low or unknown, which keeps the
 * overlay off the globe entirely.
 */
function buildAuroraPaths(kp: number | null): Position[][] {
  if (kp === null || kp < AURORA_KP_THRESHOLD) return [];
  const equatorBoundaryDeg = Math.max(50, 67 - 2 * kp);
  return [smallCircle(equatorBoundaryDeg), smallCircle(-equatorBoundaryDeg)];
}

/** Closed ring at constant geographic latitude, sampled every {@link AURORA_STEP_DEG}°. */
function smallCircle(lat: number): Position[] {
  const points: Position[] = [];
  for (let lon = -180; lon <= 180; lon += AURORA_STEP_DEG) {
    points.push({
      lat,
      lon,
      alt: 0.05,
      velocity: 0,
      timestamp: '1970-01-01T00:00:00.000Z',
    });
  }
  return points;
}

/** Heuristic discriminator — auroral rings are flagged by their zero-velocity sentinel. */
function isAuroraPath(points: Position[]): boolean {
  const first = points[0];
  return first !== undefined && first.velocity === 0;
}

/** Opacity scaled by storm severity. Caps at Kp = 9 (max NOAA value). */
function auroraOpacity(kp: number): number {
  const clamped = Math.min(Math.max(kp - AURORA_KP_THRESHOLD, 0), 9 - AURORA_KP_THRESHOLD);
  return 0.25 + 0.45 * (clamped / (9 - AURORA_KP_THRESHOLD));
}

/** Tooltip text shown on hover. */
function formatLabel(d: SatelliteWithPosition): string {
  const alt = d.position.alt.toFixed(1);
  const vel = d.position.velocity.toFixed(2);
  return `<div style="font-family:'JetBrains Mono',monospace;font-size:11px">
    <strong>${escapeHtml(d.satellite.name)}</strong><br/>
    NORAD ${d.satellite.noradId}<br/>
    alt ${alt} km · vel ${vel} km/s
  </div>`;
}

function formatObserverLabel(o: ObserverLocation): string {
  return `<div style="font-family:'JetBrains Mono',monospace;font-size:11px">
    <strong>observer</strong><br/>
    ${o.lat.toFixed(2)}° ${o.lon.toFixed(2)}°
  </div>`;
}

/** Minimal HTML escape — satellite names from Celestrak shouldn't contain HTML, but be safe. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
