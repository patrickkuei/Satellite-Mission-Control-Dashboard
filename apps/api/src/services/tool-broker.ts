/**
 * ToolBroker — validates LLM-emitted tool arguments and dispatches to the
 * registered handler, packaging both successes and failures into a uniform
 * `{ content, isError }` envelope the agent can hand back to the model.
 *
 * Three failure classes, all reported the same way:
 *   1. Unknown tool name — model invented something not in the registry.
 *   2. Schema-invalid args — model called the right tool with the wrong shape.
 *   3. Handler threw — upstream service failure (Celestrak down, sat not in set, …).
 *
 * Each becomes a `tool_result` with `isError: true`, which both providers
 * surface to the model so it can self-correct (try a different name, fix the
 * arguments, etc.). The orchestrator caps consecutive self-corrections.
 */
import Ajv, { type ValidateFunction } from 'ajv';
import type { Tool } from '@orbit-ctrl/tools';

/** Uniform result envelope returned to the LLM via {@link NormalizedMessage} `role: 'tool'`. */
export interface ToolResult {
  content: string;
  isError: boolean;
}

/** Public surface of the broker. */
export interface ToolBroker {
  /**
   * Dispatch one tool call. Always resolves — never rejects. The orchestrator
   * inspects `isError` to decide whether to count toward the self-correction
   * cap.
   *
   * @param name - Tool name as emitted by the model.
   * @param args - Raw argument JSON; validated against the tool's schema.
   */
  call(name: string, args: unknown): Promise<ToolResult>;
}

/**
 * Build a broker bound to a fixed tool registry. Compiles each tool's input
 * schema once at construction so per-call validation is just a function call.
 *
 * @example
 * ```ts
 * const broker = createToolBroker(toolRegistry);
 * const result = await broker.call('get_satellite_position', { name: 'ISS' });
 * if (result.isError) console.error(result.content);
 * ```
 */
export function createToolBroker(tools: Tool[]): ToolBroker {
  // Cast: the runtime Ajv export is the constructor, but the bundled types
  // declare it as a namespace. New it via the value side without fighting TS.
  const AjvCtor = Ajv as unknown as new () => Ajv;
  const ajv = new AjvCtor();
  const byName = new Map<string, { tool: Tool; validate: ValidateFunction }>();
  for (const tool of tools) {
    byName.set(tool.name, { tool, validate: ajv.compile(tool.inputSchema) });
  }

  return {
    async call(name, args) {
      const entry = byName.get(name);
      if (!entry) {
        return {
          content: `Unknown tool: "${name}". Valid tools: ${[...byName.keys()].join(', ')}`,
          isError: true,
        };
      }
      const argObj = args && typeof args === 'object' ? args : {};
      if (!entry.validate(argObj)) {
        return {
          content: `Invalid arguments for ${name}: ${ajv.errorsText(entry.validate.errors)}`,
          isError: true,
        };
      }
      try {
        const out = await entry.tool.execute(argObj);
        return { content: JSON.stringify(out), isError: false };
      } catch (err) {
        return { content: `Tool error: ${(err as Error).message}`, isError: true };
      }
    },
  };
}
