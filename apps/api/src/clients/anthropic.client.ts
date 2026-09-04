/**
 * Anthropic adapter — implements {@link LLMProvider} on `@anthropic-ai/sdk`.
 *
 * Secondary provider for the demo. Its presence validates that the
 * `LLMProvider` abstraction holds across SDKs with materially different
 * tool-calling shapes: Anthropic's `tool_use` content blocks (where each
 * tool call streams in as fragmented `input_json_delta` partials) vs.
 * Gemini's atomic `functionCall` parts.
 *
 * Model: `claude-sonnet-4-6` — latest Sonnet 4.x at the time Phase 4 was
 * built. Override via constructor option for forward compatibility.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMEvent,
  LLMProvider,
  LLMChatRequest,
  NormalizedMessage,
  NormalizedTool,
  LLMStopReason,
} from './llm-provider.js';
import { withBackoff } from './backoff.js';

/** Default Anthropic model. Latest Sonnet 4.x. */
const DEFAULT_MODEL = 'claude-sonnet-4-6';
/** Cap on response length. Comfortable for a multi-turn tool-using agent. */
const DEFAULT_MAX_TOKENS = 2048;

/** Construction-time options for the Anthropic provider. */
export interface AnthropicProviderOptions {
  apiKey: string;
  /** Model ID. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  /** Per-turn `max_tokens`. Defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
}

/**
 * Build an Anthropic-backed {@link LLMProvider}.
 *
 * @throws If `apiKey` is empty — fail fast at startup rather than per-request.
 *
 * @example
 * ```ts
 * const provider = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
 * ```
 */
export function createAnthropicProvider(opts: AnthropicProviderOptions): LLMProvider {
  if (!opts.apiKey) throw new Error('AnthropicProvider: missing apiKey');
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    name: `anthropic:${model}`,
    chat(req) {
      return streamAnthropic(client, model, maxTokens, req);
    },
  };
}

/** Async generator that yields normalized events from one Anthropic turn. */
async function* streamAnthropic(
  client: Anthropic,
  model: string,
  maxTokens: number,
  req: LLMChatRequest,
): AsyncIterable<LLMEvent> {
  // `messages.stream` returns a sync iterator-with-promise hybrid; wrap in an
  // async fn so `withBackoff`'s retry classifier can see network errors.
  const stream = await withBackoff(async () =>
    client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      tools: req.tools.map((t) => toAnthropicTool(t)),
    }),
  );

  const state: AnthropicStreamState = { toolBlocks: new Map(), stopReason: 'end_turn' };

  for await (const event of stream) {
    yield* handleAnthropicEvent(event, state);
  }

  yield { type: 'stop', reason: state.stopReason };
}

interface AnthropicStreamState {
  /** Per-block buffers: index → { id, name, partialJson }. */
  toolBlocks: Map<number, { id: string; name: string; partialJson: string }>;
  stopReason: LLMStopReason;
}

/**
 * Translate one raw SDK event into zero-or-more {@link LLMEvent}s, mutating
 * the shared {@link AnthropicStreamState}. Pulled out of the main loop so
 * each branch stays trivially analysable.
 */
function* handleAnthropicEvent(
  event: Anthropic.MessageStreamEvent,
  state: AnthropicStreamState,
): Generator<LLMEvent, void, void> {
  if (event.type === 'content_block_start') {
    if (event.content_block.type === 'tool_use') {
      state.toolBlocks.set(event.index, {
        id: event.content_block.id,
        name: event.content_block.name,
        partialJson: '',
      });
    }
    return;
  }
  if (event.type === 'content_block_delta') {
    yield* handleDelta(event, state);
    return;
  }
  if (event.type === 'content_block_stop') {
    const buf = state.toolBlocks.get(event.index);
    if (!buf) return;
    state.toolBlocks.delete(event.index);
    yield {
      type: 'tool_call',
      id: buf.id,
      name: buf.name,
      args: parseJsonOrEmpty(buf.partialJson),
    };
    return;
  }
  if (event.type === 'message_delta') {
    state.stopReason = mapStopReason(event.delta.stop_reason);
  }
}

/** Handle a `content_block_delta` event: text → emit, JSON → buffer. */
function* handleDelta(
  event: Anthropic.RawContentBlockDeltaEvent,
  state: AnthropicStreamState,
): Generator<LLMEvent, void, void> {
  if (event.delta.type === 'text_delta') {
    yield { type: 'text', delta: event.delta.text };
    return;
  }
  if (event.delta.type === 'input_json_delta') {
    const buf = state.toolBlocks.get(event.index);
    if (buf) buf.partialJson += event.delta.partial_json;
  }
}

/** Normalize Anthropic's stop_reason vocabulary onto {@link LLMStopReason}. */
function mapStopReason(reason: string | null | undefined): LLMStopReason {
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'max_tokens') return 'max_tokens';
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'end_turn';
  return 'end_turn';
}

/** Convert one normalized tool definition to Anthropic's tool shape. */
function toAnthropicTool(t: NormalizedTool): Anthropic.Tool {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
  };
}

/**
 * Convert normalized messages into Anthropic's `MessageParam[]`. Tool results
 * are sent as a `user` message containing a `tool_result` content block.
 *
 * `NormalizedMessage` only carries the *result* side of a tool call
 * (`toolCallId`/`toolName` on the `role: 'tool'` message) — the orchestrator
 * never records a structured `tool_use` block on the preceding assistant
 * message. Anthropic's Messages API requires one: every `tool_result` block
 * must trace back to a `tool_use` block with a matching `id` on the
 * assistant message immediately before it, or the request is rejected. This
 * reconstructs that pairing (same fix as `groq.client.ts`'s
 * `toGroqMessages`, applied here since Anthropic's Messages API has the
 * identical requirement).
 *
 * The original call arguments aren't available at this layer (only the
 * result is threaded through history), so reconstructed `tool_use` blocks
 * use a placeholder `input: {}` — Anthropic only needs the `id`/`name` to
 * resolve the pairing, not the original arguments. Same documented fidelity
 * gap as the Groq adapter: two consecutive hops with no assistant text in
 * either one get merged onto one synthetic assistant message.
 *
 * @internal exported for testing.
 */
export function toAnthropicMessages(messages: NormalizedMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  // The assistant message currently accumulating tool_use blocks for the
  // in-progress run of tool results. Reset whenever a genuinely new
  // assistant/user message appears; reused across consecutive tool
  // messages from the same hop.
  let pendingToolUseAssistant: Anthropic.MessageParam | null = null;

  for (const msg of messages) {
    if (msg.role === 'tool') {
      const toolUseBlock: Anthropic.ToolUseBlockParam = {
        type: 'tool_use',
        id: msg.toolCallId ?? '',
        name: msg.toolName ?? 'unknown_tool',
        input: {},
      };
      if (pendingToolUseAssistant && Array.isArray(pendingToolUseAssistant.content)) {
        pendingToolUseAssistant.content.push(toolUseBlock);
      } else {
        pendingToolUseAssistant = { role: 'assistant', content: [toolUseBlock] };
        result.push(pendingToolUseAssistant);
      }
      result.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId ?? '',
            content: msg.content,
            is_error: Boolean(msg.isError),
          },
        ],
      });
      continue;
    }

    pendingToolUseAssistant = null;
    if (msg.role === 'assistant') {
      const pushed: Anthropic.MessageParam = {
        role: 'assistant',
        content: [{ type: 'text', text: msg.content }],
      };
      result.push(pushed);
      // Anticipate this hop's tool_use blocks (if any) attaching here,
      // matching how the orchestrator interleaves them.
      pendingToolUseAssistant = pushed;
    } else {
      result.push({ role: 'user', content: msg.content });
    }
  }

  return result;
}

/**
 * Defensive JSON parse — Anthropic occasionally emits an empty
 * `input_json_delta` stream for parameter-less tool calls. Fall back to an
 * empty object so the broker can still validate.
 */
function parseJsonOrEmpty(s: string): unknown {
  if (!s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
