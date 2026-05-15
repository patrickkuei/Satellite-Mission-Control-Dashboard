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
import type {
  LLMEvent,
  LLMProvider,
  NormalizedMessage,
  NormalizedTool,
} from '../clients/llm-provider.js';
import type { Tool } from '@orbit-ctrl/tools';
import type { ToolBroker } from './tool-broker.js';

/** Hard cap on tool-hop chains. Stops runaway loops if the model never gets `end_turn`. */
const MAX_TURNS = 8;

/**
 * One event yielded by {@link AgentService.chat}.
 *
 * - `text`       — incremental assistant text; concatenate to render.
 * - `tool_start` — broker is about to dispatch a tool call.
 * - `tool_end`   — tool call completed (success or error).
 * - `error`      — fatal: orchestrator gave up (e.g., self-correction cap hit).
 * - `done`       — final event of the stream, always last.
 */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; isError: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Construction-time dependencies for {@link createAgentService}. */
export interface AgentServiceDeps {
  llm: LLMProvider;
  broker: ToolBroker;
  tools: Tool[];
  /** Consecutive tool errors before the orchestrator aborts the chain. Default 3. */
  maxSelfCorrections?: number;
}

/** Public surface. One method, streaming. */
export interface AgentService {
  /**
   * Run one user message through the agent loop, streaming events.
   *
   * @param userMessage - Free-text user prompt.
   *
   * @example
   * ```ts
   * for await (const evt of agent.chat('What\'s overhead in Tokyo right now?')) {
   *   if (evt.type === 'text') process.stdout.write(evt.delta);
   * }
   * ```
   */
  chat(userMessage: string): AsyncIterable<AgentEvent>;
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
  'Be concise. Report units. Times are UTC unless the user specifies otherwise.',
].join(' ');

/** Build the orchestrator with the given provider, broker, and tool set. */
export function createAgentService(deps: AgentServiceDeps): AgentService {
  const maxSelfCorrections = deps.maxSelfCorrections ?? 3;
  const normalizedTools: NormalizedTool[] = deps.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as object,
  }));

  return {
    async *chat(userMessage) {
      const messages: NormalizedMessage[] = [{ role: 'user', content: userMessage }];
      let consecutiveErrors = 0;

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const turnResult = await runOneTurn(deps.llm, messages, normalizedTools);
        for (const evt of turnResult.events) yield evt;

        if (turnResult.assistantText) {
          messages.push({ role: 'assistant', content: turnResult.assistantText });
        }
        if (turnResult.toolCalls.length === 0) break;

        const sawError = yield* dispatchToolCalls(turnResult.toolCalls, messages, deps.broker);
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
 * Dispatch every buffered tool call through the broker, appending each
 * result as a `role: 'tool'` message and yielding `tool_start` / `tool_end`
 * events for the UI. Returns whether any call failed (so the outer loop
 * can advance its self-correction counter).
 */
async function* dispatchToolCalls(
  calls: TurnResult['toolCalls'],
  messages: NormalizedMessage[],
  broker: AgentServiceDeps['broker'],
): AsyncGenerator<AgentEvent, boolean, void> {
  let sawError = false;
  for (const call of calls) {
    yield { type: 'tool_start', name: call.name };
    const result = await broker.call(call.name, call.args);
    yield { type: 'tool_end', name: call.name, isError: result.isError };
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
  /** Buffered `text` events to surface before any tool dispatch. */
  events: AgentEvent[];
  assistantText: string;
  toolCalls: Array<{ id: string; name: string; args: unknown }>;
}

/**
 * Consume one provider stream into the turn's accumulated state. Kept as a
 * separate helper so the {@link AgentService.chat} loop stays under the
 * cognitive-complexity cap.
 */
async function runOneTurn(
  llm: LLMProvider,
  messages: NormalizedMessage[],
  tools: NormalizedTool[],
): Promise<TurnResult> {
  const events: AgentEvent[] = [];
  let assistantText = '';
  const toolCalls: TurnResult['toolCalls'] = [];

  for await (const evt of llm.chat({ system: SYSTEM_PROMPT, messages, tools })) {
    handleEvent(evt, events, toolCalls, (delta) => {
      assistantText += delta;
    });
  }

  return { events, assistantText, toolCalls };
}

function handleEvent(
  evt: LLMEvent,
  events: AgentEvent[],
  toolCalls: TurnResult['toolCalls'],
  appendText: (delta: string) => void,
): void {
  if (evt.type === 'text') {
    appendText(evt.delta);
    events.push({ type: 'text', delta: evt.delta });
  } else if (evt.type === 'tool_call') {
    toolCalls.push({ id: evt.id, name: evt.name, args: evt.args });
  }
  // `stop` events are terminal markers; the for-await ends naturally.
}
