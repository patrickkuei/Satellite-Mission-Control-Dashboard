/**
 * `@orbit-ctrl/tools` — single source of truth for AI tool *metadata*.
 *
 * The shapes here are consumed by two independent assemblers:
 *   1. The in-process agent in `apps/api` (binds `execute` to local services).
 *   2. The MCP server in `packages/mcp-server` (binds `execute` to HTTP calls).
 *
 * Keeping metadata (name / description / input schema) here — and `execute`
 * out of it — lets both consumers agree on the contract the LLM sees, without
 * coupling either package to the other's runtime.
 *
 * @packageDocumentation
 */

/**
 * JSON Schema fragment describing a tool's input. Constrained to the subset
 * accepted by both Anthropic tool-calling and Gemini function-declaration
 * schemas (no `oneOf`, no `$ref`, no nested object properties).
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

/** Single JSON Schema property — sufficient for our tool inputs (no nested objects yet). */
export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  enum?: readonly (string | number)[];
  items?: JSONSchemaProperty;
}

/**
 * Tool metadata — everything the LLM needs to decide whether and how to call
 * the tool. Pure data; no runtime behaviour. Assembled into a {@link Tool} by
 * each consumer with its own `execute` binding.
 */
export interface ToolDefinition {
  /** Snake-case identifier the LLM uses to invoke the tool. */
  name: string;
  /**
   * One-sentence description shown to the LLM during tool selection.
   * Describes *when* to use the tool, not just *what* it does.
   */
  description: string;
  /** JSON Schema for the input — validated before `execute` is called. */
  inputSchema: ToolInputSchema;
}

/**
 * An assembled tool: metadata + a runtime handler. Built by the agent and
 * MCP server from {@link toolDefinitions}; never exported from this package.
 *
 * @typeParam TInput  - Shape of the validated input object passed to `execute`.
 * @typeParam TOutput - Shape returned by `execute` (will be JSON-serialized).
 */
export interface Tool<TInput = unknown, TOutput = unknown> extends ToolDefinition {
  /** Async handler. Throws on upstream errors; the broker turns the throw into a `tool_result` error. */
  execute: (input: TInput) => Promise<TOutput>;
}

/** Canonical name list — handy for switch-cases when binding executes. */
export const TOOL_NAMES = {
  GET_SATELLITE_POSITION: 'get_satellite_position',
  PREDICT_PASSES: 'predict_passes',
  GET_SPACE_WEATHER: 'get_space_weather',
  GET_SATELLITE_TELEMETRY: 'get_satellite_telemetry',
  GET_ANOMALIES: 'get_anomalies',
  FIND_SATELLITES_ABOVE: 'find_satellites_above',
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/**
 * The six tools exposed to language models. Schemas are deliberately small
 * and conservative — anything the LLM cannot express in a top-level scalar
 * field (e.g., nested objects) is flattened.
 *
 * Descriptions are written for an LLM, not a human: they emphasise *when*
 * a tool should be chosen and what inputs are required.
 */
export const toolDefinitions: ReadonlyArray<ToolDefinition> = [
  {
    name: TOOL_NAMES.GET_SATELLITE_POSITION,
    description:
      'Return the current or historical orbital position (lat/lon/altitude/velocity) of a tracked satellite. Use this when the user asks where a specific satellite is right now or at a given time.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Satellite name as it appears in the catalog (e.g., "ISS (ZARYA)", "HST", or NORAD ID as a string).',
        },
        time: {
          type: 'string',
          description: 'Optional ISO-8601 timestamp. Defaults to now.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: TOOL_NAMES.PREDICT_PASSES,
    description:
      'Predict when a satellite will be visible above the horizon from a ground location over the next N hours. Returns a list of passes with start/end/peak times and max elevation. Use when the user asks "when will X be overhead" or "next pass over Y".',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Satellite name as it appears in the catalog.',
        },
        lat: { type: 'number', description: 'Observer latitude in degrees (−90 to 90).' },
        lon: { type: 'number', description: 'Observer longitude in degrees (−180 to 180).' },
        hours: {
          type: 'number',
          description: 'Forward window length in hours (1–72).',
        },
      },
      required: ['name', 'lat', 'lon', 'hours'],
    },
  },
  {
    name: TOOL_NAMES.GET_SPACE_WEATHER,
    description:
      'Return current space weather conditions: Kp planetary index, solar wind speed/density, X-ray flux class, and a one-word summary (quiet/active/storm). Use when the user asks about geomagnetic activity, solar storms, or aurora conditions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: TOOL_NAMES.GET_SATELLITE_TELEMETRY,
    description:
      "Return the latest simulated telemetry sample (bus voltage, internal temperature, attitude) for one tracked satellite. Use when the user asks about a spacecraft's health, power, or thermal state.",
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Satellite name as it appears in the catalog.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: TOOL_NAMES.GET_ANOMALIES,
    description:
      'Return recent anomaly detections from the on-board health monitor. Optionally filter by satellite name and look-back window. Use when the user asks about alerts, anomalies, faults, or unusual readings.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Optional — limit to one satellite by name. Omit for all.',
        },
        sinceMinutes: {
          type: 'number',
          description: 'Look-back window in minutes. Defaults to 30.',
        },
      },
    },
  },
  {
    name: TOOL_NAMES.FIND_SATELLITES_ABOVE,
    description:
      'List tracked satellites currently above the horizon at a ground location, sorted by elevation. Use when the user asks "what\'s overhead right now" or wants to filter satellites by visibility.',
    inputSchema: {
      type: 'object',
      properties: {
        lat: { type: 'number', description: 'Observer latitude in degrees.' },
        lon: { type: 'number', description: 'Observer longitude in degrees.' },
        minElevationDeg: {
          type: 'number',
          description: 'Minimum elevation in degrees to include (default 0).',
        },
      },
      required: ['lat', 'lon'],
    },
  },
];
