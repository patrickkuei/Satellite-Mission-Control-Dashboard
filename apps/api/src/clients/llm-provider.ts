/**
 * `LLMProvider` — the only LLM abstraction the agent orchestrator ever sees.
 *
 * Both the Gemini and Anthropic adapters implement this interface; everything
 * provider-specific (auth, message-shape translation, streaming event names)
 * is the adapter's problem, not the orchestrator's. Adding a third provider
 * later means writing a third adapter — *not* threading another conditional
 * through {@link AgentService}.
 *
 * Events are emitted as an `AsyncIterable<LLMEvent>` rather than a Promise,
 * so the orchestrator (and the SSE route above it) can stream tokens to the
 * client as they arrive — typical first-token latency is far lower than
 * end-to-end latency on multi-hop tool chains.
 *
 * @packageDocumentation
 */

/** Reason the model stopped emitting events this turn. */
export type LLMStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'error';

/**
 * One event in the model's output stream.
 *
 * - `text`     — incremental text token(s); concatenate to build the message.
 * - `tool_call` — model decided to call a tool. `args` is the raw JSON object
 *                 the model produced; validation happens in the {@link ToolBroker}.
 * - `stop`     — end of this turn. Always emitted last.
 */
export type LLMEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'stop'; reason: LLMStopReason };

/**
 * Tool advertised to the LLM. Identical shape to MCP `tools/list` entries so
 * the same definitions feed both the in-process agent and the MCP server.
 */
export interface NormalizedTool {
  name: string;
  description: string;
  inputSchema: object;
}

/**
 * One message in the conversation history fed to the LLM. The `role: 'tool'`
 * variant carries a tool *result* (or error) back to the model.
 */
export interface NormalizedMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** Required when `role === 'tool'` — links the result back to the originating `tool_call`. */
  toolCallId?: string;
  /** Required when `role === 'tool'` and the call failed — lets the model self-correct. */
  toolName?: string;
  /** True when the tool result is an error; surfaces to the model as `is_error: true`. */
  isError?: boolean;
}

/** Arguments accepted by {@link LLMProvider.chat}. */
export interface LLMChatRequest {
  /** System prompt. Sent as the system instruction on each turn. */
  system: string;
  /** Conversation history, oldest first. The provider appends its response. */
  messages: NormalizedMessage[];
  /** Tools advertised this turn. Same set on every call within a session. */
  tools: NormalizedTool[];
}

/**
 * Provider-agnostic LLM facade. One method, streaming events.
 *
 * Implementations:
 *   - `GeminiProvider`   in `gemini.client.ts`   — primary (free tier)
 *   - `AnthropicProvider` in `anthropic.client.ts` — secondary
 */
export interface LLMProvider {
  /** Human-readable provider name, for logging only. */
  readonly name: string;
  /**
   * Send one chat turn and stream the response.
   *
   * @example
   * ```ts
   * for await (const evt of provider.chat({ system, messages, tools })) {
   *   if (evt.type === 'text') process.stdout.write(evt.delta);
   * }
   * ```
   */
  chat(req: LLMChatRequest): AsyncIterable<LLMEvent>;
}
