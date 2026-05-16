/**
 * Agent tool registry — binds {@link toolDefinitions} from `@orbit-ctrl/tools`
 * to in-process service calls so the agent can execute them locally.
 *
 * The MCP server (Phase 5) builds a separate registry from the same
 * definitions, but with executes that fan out as HTTP calls to this API.
 * Keeping the metadata in `packages/tools` and the bindings here means both
 * consumers stay in sync on the LLM-visible contract while remaining
 * independent at runtime.
 */
import type { Tool } from '@orbit-ctrl/tools';
import { toolDefinitions, TOOL_NAMES } from '@orbit-ctrl/tools';
import type { Satellite } from '@orbit-ctrl/types';
import type { SatelliteService } from './satellite.service.js';
import type { WeatherService } from './weather.service.js';
import type { TelemetryService } from './telemetry.service.js';
import type { OrbitService } from './orbit.service.js';
import type { AnomalyLogService } from './anomaly-log.service.js';

/** Construction-time dependencies for the agent tool registry. */
export interface AgentToolsDeps {
  satellite: SatelliteService;
  weather: WeatherService;
  telemetry: TelemetryService;
  orbit: OrbitService;
  anomalyLog: AnomalyLogService;
}

/**
 * Build an executable tool registry by zipping {@link toolDefinitions} with
 * in-process service calls.
 *
 * @example
 * ```ts
 * const tools = createAgentToolRegistry({ satellite, weather, telemetry, orbit, anomalyLog });
 * const broker = createToolBroker(tools);
 * ```
 */
export function createAgentToolRegistry(deps: AgentToolsDeps): Tool[] {
  const handlers: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
    [TOOL_NAMES.GET_SATELLITE_POSITION]: async (input) => {
      const name = requireString(input, 'name');
      const sat = await findByName(deps.satellite, name);
      const time = parseOptionalDate(input.time);
      return deps.satellite.positionOf(sat.noradId, time);
    },

    [TOOL_NAMES.PREDICT_PASSES]: async (input) => {
      const name = requireString(input, 'name');
      const lat = requireNumber(input, 'lat');
      const lon = requireNumber(input, 'lon');
      const hours = requireNumber(input, 'hours');
      const sat = await findByName(deps.satellite, name);
      return deps.satellite.passesOf(sat.noradId, { lat, lon }, hours);
    },

    [TOOL_NAMES.GET_SPACE_WEATHER]: async () => deps.weather.getCurrent(),

    [TOOL_NAMES.GET_SATELLITE_TELEMETRY]: async (input) => {
      const name = requireString(input, 'name');
      const sat = await findByName(deps.satellite, name);
      const samples = await deps.telemetry.sample();
      const own = samples.find((s) => s.satelliteId === sat.noradId);
      if (!own) throw new Error(`No telemetry available for ${sat.name}`);
      return own;
    },

    [TOOL_NAMES.GET_ANOMALIES]: async (input) => {
      const sinceMinutes = typeof input.sinceMinutes === 'number' ? input.sinceMinutes : undefined;
      let satelliteId: number | undefined;
      if (typeof input.name === 'string' && input.name.trim()) {
        const sat = await findByName(deps.satellite, input.name);
        satelliteId = sat.noradId;
      }
      return deps.anomalyLog.recent({ satelliteId, sinceMinutes });
    },

    [TOOL_NAMES.FIND_SATELLITES_ABOVE]: async (input) => {
      const lat = requireNumber(input, 'lat');
      const lon = requireNumber(input, 'lon');
      const minElevationDeg = typeof input.minElevationDeg === 'number' ? input.minElevationDeg : 0;
      const all = await deps.satellite.list();
      const now = new Date();
      const visible = all
        .map((sat) => {
          const look = deps.orbit.lookAnglesAt(sat, { lat, lon }, now);
          if (!look) return null;
          return {
            name: sat.name,
            noradId: sat.noradId,
            elevationDeg: round2(look.elevationDeg),
            azimuthDeg: round2(look.azimuthDeg),
            rangeKm: round2(look.rangeKm),
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null && s.elevationDeg >= minElevationDeg)
        .sort((a, b) => b.elevationDeg - a.elevationDeg);

      // Cap at 10 to keep the tool result digestible for the LLM.
      // A full list of 30-50 satellites causes the model to loop rather than summarise.
      const shown = visible.slice(0, 10);
      return {
        totalVisible: visible.length,
        showing: shown.length,
        note: visible.length > 10 ? `Showing top 10 of ${visible.length} by elevation.` : undefined,
        satellites: shown,
      };
    },
  };

  return toolDefinitions.map((def) => {
    const handler = handlers[def.name];
    if (!handler) throw new Error(`agent-tools: no handler bound for "${def.name}"`);
    return {
      ...def,
      execute: (input: unknown) => handler((input ?? {}) as Record<string, unknown>),
    };
  });
}

/**
 * Locate a satellite by name. Matches are case-insensitive substring matches
 * on the catalog name; falls back to NORAD ID if the input parses as a number.
 *
 * @throws If no satellite matches.
 */
async function findByName(svc: SatelliteService, query: string): Promise<Satellite> {
  const list = await svc.list();
  const numeric = Number(query);
  if (Number.isInteger(numeric)) {
    const byId = list.find((s) => s.noradId === numeric);
    if (byId) return byId;
  }
  const needle = query.toLowerCase().trim();
  const byName = list.find((s) => s.name.toLowerCase().includes(needle));
  if (byName) return byName;
  throw new Error(`Satellite "${query}" not found in tracked set`);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Missing required string parameter "${key}"`);
  }
  return v;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`Missing required numeric parameter "${key}"`);
  }
  return v;
}

function parseOptionalDate(v: unknown): Date | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ISO-8601 timestamp: ${v}`);
  return d;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
