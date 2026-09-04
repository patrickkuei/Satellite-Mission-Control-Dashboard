/**
 * Agent orchestrator — drives the multi-hop conversation loop.
 *
 * Provider-agnostic by design: it only knows about {@link LLMProvider},
 * {@link ToolBroker}, and conversation state. Swapping Gemini for Anthropic
 * (or anything else) is a {@link LLMProvider} swap at the composition root.
 *
 * The loop:
 *   1. Stream the model's response. Forward `text` deltas to the caller,
 *      buffer `tool_call` events.
 *   2. On `stop`: if no tool calls were buffered, the turn is done.
 *   3. Otherwise, dispatch every buffered tool call through the broker,
 *      append each result as a `role: 'tool'` message, and loop back to (1).
 *   4. Track consecutive tool *errors*. After {@link maxSelfCorrections}
 *      in a row, abort — the model is stuck.
 *
 * The orchestrator yields `AgentEvent`s (rather than raw strings) so the
 * route layer can surface visible tool calls in the chat UI.
 */
import type { LLMProvider, NormalizedMessage, NormalizedTool } from '../clients/llm-provider.js';
import type { Tool } from '@orbit-ctrl/tools';
import { TOOL_NAMES } from '@orbit-ctrl/tools';
import type { ToolBroker } from './tool-broker.js';

/** Hard cap on tool-hop chains. Stops runaway loops if the model never gets `end_turn`. */
const MAX_TURNS = 8;

/**
 * Number of recent user/assistant exchange messages to keep verbatim.
 * Older turns beyond this window are summarised into a single injected pair
 * so the model retains earlier context without blowing the free-tier budget.
 * 6 messages = 3 full exchanges.
 */
const HISTORY_WINDOW = 6;

/**
 * One event yielded by {@link AgentService.chat}.
 *
 * - `text`             — incremental assistant text; concatenate to render.
 * - `tool_start`       — broker is about to dispatch a tool call.
 * - `tool_end`         — tool call completed (success or error).
 * - `select_satellite` — satellite-specific tool succeeded; browser should highlight it on the globe.
 * - `error`            — fatal: orchestrator gave up (e.g., self-correction cap hit).
 * - `done`             — final event of the stream, always last.
 */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; isError: boolean }
  | { type: 'select_satellite'; noradId: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Minimal logger surface — narrow enough that any pino instance satisfies it. */
export interface AgentServiceLogger {
  warn(msg: string): void;
}

/** Construction-time dependencies for {@link createAgentService}. */
export interface AgentServiceDeps {
  /**
   * Ordered provider chain. The orchestrator tries each in sequence when the
   * previous one exhausts its retry budget. Typical chain: Gemini → Groq → Anthropic.
   */
  llm: LLMProvider[];
  broker: ToolBroker;
  tools: Tool[];
  /** Consecutive tool errors before the orchestrator aborts the chain. Default 3. */
  maxSelfCorrections?: number;
  /**
   * Logs a per-provider failure (with the underlying error message) before
   * advancing to the next provider or giving up. Without this, a provider
   * failure is otherwise invisible server-side — the client only ever sees
   * the generic "All providers failed" message.
   */
  logger: AgentServiceLogger;
}

/**
 * One prior exchange from the frontend conversation transcript.
 * Only user/assistant turns are sent — tool call internals stay server-side.
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Public surface. One method, streaming. */
export interface AgentService {
  /**
   * Run one user message through the agent loop, streaming events.
   *
   * @param userMessage - Free-text user prompt.
   * @param history     - Prior conversation turns from the client. The service
   *                      compacts this to fit within the model's context budget
   *                      before prepending it to the new message.
   *
   * @example
   * ```ts
   * for await (const evt of agent.chat('When can I see it?', history)) {
   *   if (evt.type === 'text') process.stdout.write(evt.delta);
   * }
   * ```
   */
  chat(userMessage: string, history?: ConversationTurn[]): AsyncIterable<AgentEvent>;
}

/**
 * System prompt — orients the model on its role, data sources, and tool
 * vocabulary. Kept short; specifics belong in tool `description`s.
 */
const SYSTEM_PROMPT = [
  'You are orbit.ctrl, a mission-control assistant for a small fleet of tracked LEO satellites.',
  'You answer using the tools provided. Prefer calling tools over guessing — orbital state, telemetry,',
  'and space weather are always available through them. Chain tool calls when a question needs',
  'multiple data sources (e.g., predict passes, then check anomalies for the same satellite).',
  'Tool selection rules: (1) "Can I see X from Y?" or "is X visible from Y?" → always use predict_passes with the satellite name.',
  '(2) find_satellites_above is only for "what is overhead right now?" with no specific satellite.',
  '(3) Resolve pronouns like "it" or "that satellite" from conversation history before calling any tool — never ask the user to clarify if the satellite was already mentioned.',
  'IMPORTANT: call each tool at most once per user query. Once you receive a tool result, use it',
  'to compose your answer — never call the same tool again with the same arguments.',
  'Be concise. Report units. Times are UTC unless the user specifies otherwise.',
].join(' ');

/** Build the orchestrator with the given provider chain, broker, and tool set. */
export function createAgentService(deps: AgentServiceDeps): AgentService {
  const maxSelfCorrections = deps.maxSelfCorrections ?? 3;
  const normalizedTools: NormalizedTool[] = deps.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as object,
  }));

  return {
    async *chat(userMessage, history = []) {
      // Use the first provider for summarisation — it's a cheap non-streaming call.
      const primaryProvider = deps.llm[0];
      if (!primaryProvider) throw new Error('AgentService: provider chain is empty');
      const compacted = await compactHistory(history, primaryProvider);
      const messages: NormalizedMessage[] = [
        ...compacted.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: userMessage },
      ];
      let consecutiveErrors = 0;
      // Session-level cache: keyed by "name:stable-args-json" → previous result content.
      // Backstop against model loops — if the model calls the same tool with the same
      // args twice, return the cached result instantly rather than dispatching again.
      const callCache = new Map<string, string>();

      let providerIndex = 0;

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const turnResult = yield* runOneTurn(
          deps.llm,
          providerIndex,
          messages,
          normalizedTools,
          deps.logger,
        );

        const advanced = advanceProvider(turnResult.providerFailed, providerIndex, deps.llm.length);
        if (advanced.allFailed) {
          deps.logger.warn(
            `agent: all ${deps.llm.length} provider(s) in the chain failed — giving up`,
          );
          yield { type: 'error', message: 'All providers failed. Please try again later.' };
          break;
        }
        if (advanced.next !== providerIndex) {
          providerIndex = advanced.next;
          continue;
        }

        if (turnResult.assistantText) {
          messages.push({ role: 'assistant', content: turnResult.assistantText });
        }
        if (turnResult.toolCalls.length === 0) break;

        const sawError = yield* dispatchToolCalls(
          turnResult.toolCalls,
          messages,
          deps.broker,
          callCache,
        );
        consecutiveErrors = sawError ? consecutiveErrors + 1 : 0;
        if (sawError && consecutiveErrors >= maxSelfCorrections) {
          yield {
            type: 'error',
            message: `Aborting after ${maxSelfCorrections} consecutive tool errors.`,
          };
          break;
        }
      }

      yield { type: 'done' };
    },
  };
}

/**
 * Decide whether to advance to the next provider in the chain after a failure.
 * Extracted to keep the `chat` generator under the cognitive-complexity cap.
 */
function advanceProvider(
  providerFailed: boolean,
  current: number,
  chainLength: number,
): { next: number; allFailed: boolean } {
  if (!providerFailed) return { next: current, allFailed: false };
  if (current < chainLength - 1) return { next: current + 1, allFailed: false };
  return { next: current, allFailed: true };
}

/**
 * Compact conversation history to fit the model's context budget.
 *
 * If the history is within {@link HISTORY_WINDOW} messages it is returned
 * unchanged. When it exceeds the window the older portion is summarised into
 * a single sentence via one cheap non-streaming LLM call, then injected as a
 * synthetic user/assistant pair so the model sees it as natural conversation
 * context rather than a system annotation.
 *
 * @param history - Full prior turns from the client.
 * @param llm     - Provider used for the summary call (same model, no extra config).
 * @returns Compacted turn list ready to prepend to the new message.
 */
async function compactHistory(
  history: ConversationTurn[],
  llm: LLMProvider,
): Promise<ConversationTurn[]> {
  if (history.length <= HISTORY_WINDOW) return history;

  const old = history.slice(0, history.length - HISTORY_WINDOW);
  const recent = history.slice(-HISTORY_WINDOW);
  const summary = await summariseHistory(old, llm);

  return [
    {
      role: 'user',
      content: `For context, here is a summary of our earlier conversation: ${summary}`,
    },
    { role: 'assistant', content: 'Understood, I have that context.' },
    ...recent,
  ];
}

/**
 * Drain one non-streaming LLM call and return the full text response.
 * Used exclusively for history summarisation — not exposed to the agent loop.
 */
async function summariseHistory(turns: ConversationTurn[], llm: LLMProvider): Promise<string> {
  const transcript = turns
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n');

  const prompt = [
    'Summarise the following conversation in 2-3 sentences.',
    'Capture the key facts established: satellites mentioned, locations, questions asked, and answers given.',
    'Be concise — this summary will be injected as context for the next model turn.\n\n',
    transcript,
  ].join(' ');

  let text = '';
  for await (const evt of llm.chat({
    system: 'You are a helpful summariser. Output only the summary, no preamble.',
    messages: [{ role: 'user', content: prompt }],
    tools: [],
  })) {
    if (evt.type === 'text') text += evt.delta;
  }
  return text.trim() || 'Earlier conversation context unavailable.';
}

/** Single-satellite tools that should trigger a globe selection after success. */
const SATELLITE_SPECIFIC_TOOLS = new Set<string>([
  TOOL_NAMES.GET_SATELLITE_POSITION,
  TOOL_NAMES.PREDICT_PASSES,
  TOOL_NAMES.GET_SATELLITE_TELEMETRY,
  TOOL_NAMES.GET_ANOMALIES,
]);

/**
 * Extract a NORAD ID from a JSON tool result. Handles `{ noradId }`,
 * `{ satelliteId }`, and `[{ satelliteId }]` shapes. Returns `null` on
 * parse failure so the caller can skip without crashing the stream.
 */
function extractNoradId(content: string): number | null {
  try {
    const data = JSON.parse(content) as unknown;
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.noradId === 'number') return obj.noradId;
      if (typeof obj.satelliteId === 'number') return obj.satelliteId;
    }
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0] as Record<string, unknown>;
      if (typeof first.satelliteId === 'number') return first.satelliteId;
    }
  } catch {
    // Malformed JSON — skip silently.
  }
  return null;
}

/**
 * Dispatch every buffered tool call through the broker, appending each
 * result as a `role: 'tool'` message and yielding `tool_start` / `tool_end`
 * events for the UI. Returns whether any call failed (so the outer loop
 * can advance its self-correction counter).
 */
async function* dispatchToolCalls(
  calls: TurnResult['toolCalls'],
  messages: NormalizedMessage[],
  broker: AgentServiceDeps['broker'],
  callCache: Map<string, string>,
): AsyncGenerator<AgentEvent, boolean, void> {
  let sawError = false;
  for (const call of calls) {
    const cacheKey = `${call.name}:${JSON.stringify(call.args)}`;
    const cached = callCache.get(cacheKey);

    yield { type: 'tool_start', name: call.name };

    let result: { content: string; isError: boolean };
    if (cached !== undefined) {
      // Return the previous result verbatim — model is looping on an identical call.
      result = { content: cached, isError: false };
    } else {
      result = await broker.call(call.name, call.args);
      if (!result.isError) callCache.set(cacheKey, result.content);
    }

    yield { type: 'tool_end', name: call.name, isError: result.isError };

    if (!result.isError && SATELLITE_SPECIFIC_TOOLS.has(call.name)) {
      const noradId = extractNoradId(result.content);
      if (noradId !== null) yield { type: 'select_satellite', noradId };
    }

    messages.push({
      role: 'tool',
      content: result.content,
      toolCallId: call.id,
      toolName: call.name,
      isError: result.isError,
    });
    if (result.isError) sawError = true;
  }
  return sawError;
}

interface TurnResult {
  assistantText: string;
  toolCalls: Array<{ id: string; name: string; args: unknown }>;
  /** True when the provider threw before any text was emitted — caller should try next provider. */
  providerFailed: boolean;
}

/**
 * Stream one provider turn, yielding `text` events immediately as tokens
 * arrive. Tool calls are buffered (args are only complete at stream end) and
 * returned via the generator return value so the outer loop can dispatch them.
 *
 * Mid-stream error handling:
 *   - Error before first token → `providerFailed: true`, no events yielded,
 *     caller advances to the next provider in the chain.
 *   - Error after text started → re-throw so the SSE route surfaces it to the
 *     client (partial response already visible, silent retry would be confusing).
 *
 * Using `yield*` in the caller captures the return value, giving us real-time
 * text delivery without losing the tool-call list needed for the next hop.
 */
async function* runOneTurn(
  providers: LLMProvider[],
  providerIndex: number,
  messages: NormalizedMessage[],
  tools: NormalizedTool[],
  logger: AgentServiceLogger,
): AsyncGenerator<AgentEvent, TurnResult, void> {
  const llm = providers[providerIndex];
  if (!llm) return { assistantText: '', toolCalls: [], providerFailed: true };
  let assistantText = '';
  const toolCalls: TurnResult['toolCalls'] = [];

  try {
    for await (const evt of llm.chat({ system: SYSTEM_PROMPT, messages, tools })) {
      if (evt.type === 'text') {
        assistantText += evt.delta;
        yield { type: 'text', delta: evt.delta };
      } else if (evt.type === 'tool_call') {
        // Args are only fully assembled at stream end — buffer, never dispatch mid-stream.
        toolCalls.push({ id: evt.id, name: evt.name, args: evt.args });
      }
      // `stop` events are terminal markers; the for-await ends naturally.
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (assistantText.length > 0) {
      // Partial response already streamed — surface the error visibly.
      logger.warn(`agent: provider "${llm.name}" failed mid-stream: ${message}`);
      throw err;
    }
    // Nothing emitted yet — signal provider failure so the caller can fall through.
    logger.warn(`agent: provider "${llm.name}" failed before first token: ${message}`);
    return { assistantText: '', toolCalls: [], providerFailed: true };
  }

  return { assistantText, toolCalls, providerFailed: false };
}
