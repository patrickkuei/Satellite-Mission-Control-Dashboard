/**
 * Globe — 3D Earth visualisation rendering live satellite positions and the
 * selected satellite's forward ground track.
 *
 * Presentational by contract: all data + callbacks arrive via props. State,
 * polling, and HTTP live in the hooks that compose this component
 * (`useSatellites`, `useSatellitePositions`, `useGroundTrack`).
 *
 * Altitudes from `satellite.js` are in kilometres; `react-globe.gl` wants
 * fractions of an Earth radius, so we divide by `EARTH_RADIUS_KM` before
 * handing them to the renderer.
 */
import { useMemo, useRef, useEffect } from 'react';
import GlobeGL, { type GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import type { GroundTrack, Position, Satellite } from '@orbit-ctrl/types';
import styles from './Globe.module.css';

/** Mean Earth radius in km — used to normalise altitude for the renderer. */
const EARTH_RADIUS_KM = 6371;
/** Hex colour of the amber accent — design-token equivalent for Three.js objects. */
const ACCENT_COLOR = 0xff6b35;
/** Selected-satellite highlight colour (success green). */
const SELECTED_COLOR = 0x4ade80;

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
  /** Called when the user clicks a satellite point. */
  onSelect(noradId: number): void;
}

/**
 * Render Earth + tracked satellites. The component is intentionally narrow:
 * it doesn't fetch, poll, or own selection state — it only paints.
 */
export function Globe({ satellites, groundTrack, selectedId, onSelect }: GlobeProps): JSX.Element {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  // ── Auto-rotate the globe on mount for a bit of "alive" feel. ───────────
  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
  }, []);

  // Pre-compute the Three.js mesh factory so we don't rebuild a geometry
  // every frame — `react-globe.gl` re-invokes `objectThreeObject` per point.
  const buildMesh = useMemo(() => makeSatelliteMeshFactory(selectedId), [selectedId]);

  const pathsData = groundTrack ? [groundTrack.points] : [];

  return (
    <div className={styles.host}>
      <GlobeGL
        ref={globeRef}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundColor="rgba(0,0,0,0)"
        objectsData={satellites}
        objectLat={(d) => (d as SatelliteWithPosition).position.lat}
        objectLng={(d) => (d as SatelliteWithPosition).position.lon}
        objectAltitude={(d) => (d as SatelliteWithPosition).position.alt / EARTH_RADIUS_KM}
        objectLabel={(d) => formatLabel(d as SatelliteWithPosition)}
        objectThreeObject={(d) => buildMesh(d as SatelliteWithPosition)}
        onObjectClick={(d) => onSelect((d as SatelliteWithPosition).satellite.noradId)}
        pathsData={pathsData}
        pathPoints={(d) => d as Position[]}
        pathPointLat={(p) => (p as Position).lat}
        pathPointLng={(p) => (p as Position).lon}
        pathPointAlt={(p) => (p as Position).alt / EARTH_RADIUS_KM}
        pathColor={() => 'rgba(255, 107, 53, 0.45)'}
        pathStroke={1.5}
      />
    </div>
  );
}

/**
 * Build a closure that returns a fresh Three.js mesh for a given satellite
 * sample. Captured `selectedId` decides the highlight colour.
 */
function makeSatelliteMeshFactory(
  selectedId: number | null,
): (sat: SatelliteWithPosition) => THREE.Object3D {
  const geometry = new THREE.SphereGeometry(0.5, 12, 12);
  const baseMaterial = new THREE.MeshBasicMaterial({ color: ACCENT_COLOR });
  const selectedMaterial = new THREE.MeshBasicMaterial({ color: SELECTED_COLOR });

  return (sat) => {
    const material = sat.satellite.noradId === selectedId ? selectedMaterial : baseMaterial;
    return new THREE.Mesh(geometry, material);
  };
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

/** Minimal HTML escape — satellite names from Celestrak shouldn't contain HTML, but be safe. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
