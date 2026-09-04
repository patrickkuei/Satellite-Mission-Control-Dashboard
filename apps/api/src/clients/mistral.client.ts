/**
 * Mistral adapter — implements {@link LLMProvider} on `@mistralai/mistralai`.
 *
 * Free-tier fallback: Mistral's own API ("Studio", formerly "La Plateforme")
 * offers a genuine no-credit-card free tier with native tool-calling support.
 * Slotted into the chain after Groq, before the (currently unconfigured,
 * paid) Anthropic backstop.
 *
 * The SDK is Speakeasy-generated and OpenAI-adjacent: message roles and
 * `tool_calls` arrays are structurally close to Groq's, but field names are
 * camelCase (`toolCalls`, `toolCallId`, `finishReason`) rather than
 * snake_case — the SDK maps to the wire format internally.
 *
 * Translation responsibilities:
 *   - `NormalizedMessage[]` → Mistral's `ChatCompletionStreamRequestMessage[]`
 *   - `NormalizedTool[]`    → Mistral's `ChatCompletionStreamRequestTool[]`
 *   - Streamed `chat.stream` events → {@link LLMEvent}s
 */
import { Mistral } from '@mistralai/mistralai';
import type {
  AssistantMessage,
  ChatCompletionStreamRequestMessage,
  ChatCompletionStreamRequestTool,
  ToolCall,
} from '@mistralai/mistralai/models/components/index.js';
import type {
  LLMEvent,
  LLMProvider,
  LLMChatRequest,
  LLMStopReason,
  NormalizedMessage,
  NormalizedTool,
} from './llm-provider.js';
import { withBackoff } from './backoff.js';

/** Default model. Small, fast, free-tier-friendly, with native tool-calling support. */
const DEFAULT_MODEL = 'mistral-small-latest';
/** Token cap — generous enough for multi-hop tool chains. */
const DEFAULT_MAX_TOKENS = 2048;

/** Construction-time options for the Mistral provider. */
export interface MistralProviderOptions {
  apiKey: string;
  /** Model ID. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  /** Per-turn `maxTokens`. Defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
}

/**
 * Build a Mistral-backed {@link LLMProvider}.
 *
 * @throws If `apiKey` is empty — fail fast at startup rather than per-request.
 *
 * @example
 * ```ts
 * const provider = createMistralProvider({ apiKey: process.env.MISTRAL_API_KEY! });
 * for await (const evt of provider.chat({ system, messages, tools })) { ... }
 * ```
 */
export function createMistralProvider(opts: MistralProviderOptions): LLMProvider {
  if (!opts.apiKey) throw new Error('MistralProvider: missing apiKey');
  const client = new Mistral({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    name: `mistral:${model}`,
    chat(req) {
      return streamMistral(client, model, maxTokens, req);
    },
  };
}

/** Async generator that yields normalized events from one Mistral turn. */
async function* streamMistral(
  client: Mistral,
  model: string,
  maxTokens: number,
  req: LLMChatRequest,
): AsyncIterable<LLMEvent> {
  const stream = await withBackoff(() =>
    client.chat.stream({
      model,
      maxTokens,
      messages: toMistralMessages(req.system, req.messages),
      tools: req.tools.length ? req.tools.map(toMistralTool) : undefined,
      toolChoice: req.tools.length ? 'auto' : undefined,
    }),
  );

  // Mistral streams tool-call args incrementally (string fragments) or
  // occasionally as a whole object in one chunk — buffer by index either
  // way and normalize to a string, parsed once the turn completes.
  const toolBuffers = new Map<number, { id: string; name: string; argsText: string }>();
  let stopReason: LLMStopReason = 'end_turn';

  for await (const event of stream) {
    const choice = event.data.choices[0];
    if (!choice) continue;
    yield* processMistralDelta(choice.delta, toolBuffers);
    if (choice.finishReason) stopReason = mapStopReason(choice.finishReason);
    if (choice.finishReason === 'tool_calls' || choice.finishReason === 'stop') {
      for (const buf of toolBuffers.values()) {
        yield {
          type: 'tool_call',
          id: buf.id,
          name: buf.name,
          args: parseJsonOrEmpty(buf.argsText),
        };
      }
    }
  }

  yield { type: 'stop', reason: stopReason };
}

/** Yield text events and accumulate tool-call arg buffers for one stream delta. */
function* processMistralDelta(
  delta: { content?: string | unknown[] | null; toolCalls?: ToolCall[] | null },
  toolBuffers: Map<number, { id: string; name: string; argsText: string }>,
): Generator<LLMEvent, void, void> {
  if (typeof delta.content === 'string' && delta.content.length > 0) {
    yield { type: 'text', delta: delta.content };
  }
  for (const tc of delta.toolCalls ?? []) {
    const index = tc.index ?? 0;
    const argsFragment = toArgumentsFragment(tc.function.arguments);
    const buf = toolBuffers.get(index);
    if (!buf) {
      toolBuffers.set(index, {
        id: tc.id ?? `mistral-${index}`,
        name: tc.function.name,
        argsText: argsFragment,
      });
    } else {
      buf.argsText += argsFragment;
    }
  }
}

/** Normalize a tool-call `arguments` value (string or object) to a string fragment. */
function toArgumentsFragment(args: string | Record<string, unknown> | undefined): string {
  if (args === undefined) return '';
  if (typeof args === 'string') return args;
  return JSON.stringify(args);
}

/** Normalize Mistral's finish-reason vocabulary onto {@link LLMStopReason}. */
function mapStopReason(reason: string): LLMStopReason {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'error') return 'error';
  return 'end_turn';
}

/**
 * Convert normalised messages into Mistral's `ChatCompletionStreamRequestMessage[]`.
 * The system prompt is prepended as a `system` role message.
 *
 * `NormalizedMessage` only carries the *result* side of a tool call
 * (`toolCallId`/`toolName` on the `role: 'tool'` message) — nothing
 * reconstructs a `toolCalls` array on the preceding assistant message.
 * Mistral's API, like Groq's and Anthropic's, requires every tool message
 * to trace back to a named tool call on the assistant message immediately
 * before it (see `groq.client.ts`'s `toGroqMessages` for the production
 * incident — Groq's harmony template rejected the request outright without
 * this; applying the same fix here proactively rather than waiting to hit
 * it live). This reconstructs that pairing.
 *
 * The original call arguments aren't available at this layer (only the
 * result is threaded through history), so reconstructed tool calls use a
 * placeholder `arguments: '{}'` — only the name is needed to resolve the
 * pairing. Same documented fidelity gap as the Groq/Anthropic adapters: two
 * consecutive hops with no assistant text in either one get merged onto one
 * synthetic assistant message.
 *
 * @internal exported for testing.
 */
export function toMistralMessages(
  system: string,
  messages: NormalizedMessage[],
): ChatCompletionStreamRequestMessage[] {
  const result: ChatCompletionStreamRequestMessage[] = [{ role: 'system', content: system }];
  // The assistant message currently accumulating tool calls for the
  // in-progress run of tool results. Reset whenever a genuinely new
  // assistant/user message appears; reused across consecutive tool
  // messages from the same hop.
  let pendingToolCallAssistant: (AssistantMessage & { role: 'assistant' }) | null = null;

  for (const msg of messages) {
    if (msg.role === 'tool') {
      const toolCall: ToolCall = {
        id: msg.toolCallId ?? '',
        type: 'function',
        function: { name: msg.toolName ?? 'unknown_tool', arguments: '{}' },
      };
      if (pendingToolCallAssistant) {
        pendingToolCallAssistant.toolCalls = [
          ...(pendingToolCallAssistant.toolCalls ?? []),
          toolCall,
        ];
      } else {
        pendingToolCallAssistant = { role: 'assistant', toolCalls: [toolCall] };
        result.push(pendingToolCallAssistant);
      }
      result.push({
        role: 'tool',
        content: msg.content,
        toolCallId: msg.toolCallId ?? '',
        name: msg.toolName ?? 'unknown_tool',
      });
      continue;
    }

    pendingToolCallAssistant = null;
    if (msg.role === 'assistant') {
      const pushed: AssistantMessage & { role: 'assistant' } = {
        role: 'assistant',
        content: msg.content,
      };
      result.push(pushed);
      // Anticipate this hop's tool calls (if any) attaching here, matching
      // how the orchestrator interleaves them.
      pendingToolCallAssistant = pushed;
    } else {
      result.push({ role: 'user', content: msg.content });
    }
  }

  return result;
}

/** Convert one normalised tool definition to Mistral's tool shape. */
function toMistralTool(t: NormalizedTool): ChatCompletionStreamRequestTool {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  };
}

/**
 * Defensive JSON parse for tool call arguments.
 * Mirrors the Groq/Anthropic adapters' fallback for empty-arguments tools.
 */
function parseJsonOrEmpty(s: string): unknown {
  if (!s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
