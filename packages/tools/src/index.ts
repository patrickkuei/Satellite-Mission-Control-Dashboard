/**
 * @orbit-ctrl/tools — shared tool registry consumed by both the in-app AI
 * agent (Claude API tool calling) and the MCP server (external AI clients).
 *
 * A {@link Tool} is the canonical contract for any capability the system
 * exposes to a language model. Add a tool here once; both consumers pick it
 * up automatically via {@link toolRegistry}.
 *
 * @packageDocumentation
 */

/**
 * JSON Schema fragment describing a tool's input. Constrained to the subset
 * accepted by both Anthropic tool-calling and MCP `tools/list`.
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
 * A tool exposed to language models. The `name` and `description` are read
 * verbatim by the LLM — write them for the LLM, not for human docs.
 *
 * @example
 * ```ts
 * const getSpaceWeather: Tool<Record<string, never>, SpaceWeather> = {
 *   name: 'get_space_weather',
 *   description: 'Get current space weather conditions (Kp index, solar wind, X-ray flux).',
 *   inputSchema: { type: 'object', properties: {} },
 *   execute: async () => weatherService.getCurrent(),
 * };
 * ```
 *
 * @typeParam TInput  - Shape of the validated input object passed to `execute`.
 * @typeParam TOutput - Shape returned by `execute` (will be JSON-serialized).
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  /** Snake-case identifier the LLM uses to invoke the tool. */
  name: string;
  /**
   * One-sentence description shown to the LLM during tool selection.
   * Should describe *when* to use it, not just *what* it does.
   */
  description: string;
  /** JSON Schema for the input — validated before `execute` is called. */
  inputSchema: ToolInputSchema;
  /** Async handler. Throws on validation or upstream errors. */
  execute: (input: TInput) => Promise<TOutput>;
}

/**
 * The global tool registry. Phase 0 ships empty; Phase 1+ adds real tools
 * (`get_satellite_position`, `predict_passes`, `get_space_weather`,
 * `get_satellite_telemetry`, `get_anomalies`, `find_satellites_above`).
 *
 * @see docs/ARCHITECTURE.md § Layer 4 for the full tool catalog.
 */
export const toolRegistry: ReadonlyArray<Tool> = [];
