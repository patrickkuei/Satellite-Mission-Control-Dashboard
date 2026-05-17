#!/usr/bin/env node
/**
 * orbit.ctrl MCP server — Phase 5.
 *
 * Exposes the same six tools as the in-process AI agent to external MCP hosts
 * (Claude Desktop, Cursor, etc.) over stdio transport. Each tool delegates to
 * the running `apps/api` backend via HTTP so all business logic stays in one
 * place and the satellite list, anomaly log, and telemetry simulator stay
 * consistent between the dashboard UI and external AI clients.
 *
 * Required env:
 *   API_BASE_URL — base URL of the orbit.ctrl API (default http://localhost:3001)
 *
 * @packageDocumentation
 */

// McpServer (the higher-level wrapper) requires Zod schemas; our tool registry
// uses raw JSON Schema, so we use the low-level Server directly.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions } from '@orbit-ctrl/tools';

/** Base URL of the orbit.ctrl API. Configurable so the server works in production too. */
const API_BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

// ── HTTP helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch `url` and return the parsed JSON body. Throws with a descriptive
 * message on non-2xx responses so the MCP broker can surface tool errors.
 *
 * @param url - Absolute URL to fetch.
 * @returns Parsed JSON body.
 * @throws On non-2xx status or network failure.
 */
async function get(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText} (${url})`);
  }
  return res.json();
}

// ── Name resolution ──────────────────────────────────────────────────────────

interface SatelliteSummary {
  noradId: number;
  name: string;
}

/**
 * Resolve a human-supplied satellite identifier to its NORAD ID.
 *
 * Accepts either a NORAD ID string (integer) or a case-insensitive substring
 * of the catalog name (e.g. "iss", "hubble", "STARLINK-2613"). Mirrors the
 * `findByName` helper in `agent-tools.service.ts`.
 *
 * @param query - Satellite name fragment or NORAD ID as a string.
 * @returns `{ noradId, name }` of the matched satellite.
 * @throws If no satellite matches `query`.
 * @example
 * ```ts
 * const { noradId } = await resolveSatellite('ISS');
 * // noradId → 25544
 * ```
 */
async function resolveSatellite(query: string): Promise<SatelliteSummary> {
  const list = (await get(`${API_BASE_URL}/satellites`)) as SatelliteSummary[];
  const numeric = Number(query);
  if (Number.isInteger(numeric) && numeric > 0) {
    const byId = list.find((s) => s.noradId === numeric);
    if (byId) return byId;
  }
  const needle = query.toLowerCase().trim();
  const byName = list.find((s) => s.name.toLowerCase().includes(needle));
  if (!byName) throw new Error(`Satellite "${query}" not found in tracked set`);
  return byName;
}

// ── Tool execute bindings ────────────────────────────────────────────────────

type ToolInput = Record<string, unknown>;

/**
 * Execute bindings for each tool in the registry. Each function maps the
 * validated input to one or more HTTP calls against `API_BASE_URL`.
 *
 * Keyed by tool name so the handler can dispatch with a single lookup.
 */
const executes: Record<string, (input: ToolInput) => Promise<unknown>> = {
  /**
   * Get the current or historical position of a named satellite.
   *
   * @example { name: "ISS", time: "2025-01-01T00:00:00Z" }
   */
  get_satellite_position: async ({ name, time }) => {
    const { noradId } = await resolveSatellite(String(name));
    const qs = time ? `?time=${encodeURIComponent(String(time))}` : '';
    return get(`${API_BASE_URL}/satellites/${noradId}/position${qs}`);
  },

  /**
   * Predict passes of a named satellite over a ground observer.
   *
   * @example { name: "ISS", lat: 35.68, lon: 139.69, hours: 6 }
   */
  predict_passes: async ({ name, lat, lon, hours }) => {
    const { noradId } = await resolveSatellite(String(name));
    const qs = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      hours: String(hours),
    });
    return get(`${API_BASE_URL}/satellites/${noradId}/passes?${qs}`);
  },

  /**
   * Return current space weather conditions (Kp, solar wind, X-ray flux).
   *
   * @example {} (no input required)
   */
  get_space_weather: async () => get(`${API_BASE_URL}/space-weather`),

  /**
   * Return the latest telemetry sample for one named satellite.
   *
   * @example { name: "Hubble" }
   */
  get_satellite_telemetry: async ({ name }) => {
    const { noradId } = await resolveSatellite(String(name));
    const samples = (await get(`${API_BASE_URL}/telemetry/snapshot`)) as Array<{
      satelliteId: number;
    }>;
    const own = samples.find((s) => s.satelliteId === noradId);
    if (!own) throw new Error(`No telemetry available for satellite ${noradId}`);
    return own;
  },

  /**
   * Return recent anomaly detections from the health monitor.
   *
   * @example { name: "ISS", sinceMinutes: 10 }
   */
  get_anomalies: async ({ name, sinceMinutes }) => {
    const qs = new URLSearchParams();
    if (name) qs.set('name', String(name));
    if (sinceMinutes !== undefined) qs.set('sinceMinutes', String(sinceMinutes));
    const suffix = qs.toString() ? `?${qs}` : '';
    return get(`${API_BASE_URL}/anomalies${suffix}`);
  },

  /**
   * List satellites currently above the horizon at a ground location.
   *
   * @example { lat: 35.68, lon: 139.69, minElevationDeg: 10 }
   */
  find_satellites_above: async ({ lat, lon, minElevationDeg }) => {
    const qs = new URLSearchParams({ lat: String(lat), lon: String(lon) });
    if (minElevationDeg !== undefined) qs.set('minElevationDeg', String(minElevationDeg));
    return get(`${API_BASE_URL}/satellites/above?${qs}`);
  },
};

// ── MCP server setup ─────────────────────────────────────────────────────────

const server = new Server(
  { name: 'orbit-ctrl', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

/**
 * `tools/list` — advertise all tools from the shared `@orbit-ctrl/tools` registry.
 *
 * The same tool definitions power the in-process agent in `apps/api`; keeping
 * metadata in one package means descriptions and schemas stay in sync.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

/**
 * `tools/call` — execute a tool by name and return the result as text content.
 *
 * Errors surface as `isError: true` so the MCP host can relay them to the
 * model for self-correction rather than terminating the conversation.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const execute = executes[name];
  if (!execute) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    const result = await execute((args ?? {}) as ToolInput);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Tool error: ${(err as Error).message}` }],
      isError: true,
    };
  }
});

// ── Entry point ──────────────────────────────────────────────────────────────

// Log uncaught errors to stderr so Claude Code's MCP host can surface them.
// Without this, an async throw after connect() silently kills the process.
process.on('uncaughtException', (err) => {
  process.stderr.write(`[orbit-ctrl-mcp] uncaughtException: ${err.message}\n`);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[orbit-ctrl-mcp] unhandledRejection: ${String(reason)}\n`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
