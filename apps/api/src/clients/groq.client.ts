/**
 * Groq adapter — implements {@link LLMProvider} on top of `groq-sdk`.
 *
 * Groq runs open-source models (`openai/gpt-oss-120b` by default) on custom
 * inference hardware, giving sub-second first-token latency on the free tier.
 * Used as the first fallback when Gemini exhausts its retry budget.
 *
 * The Groq SDK is OpenAI-compatible, so message/tool shapes are close to
 * Anthropic's but use OpenAI-style `tool_calls` arrays rather than content
 * blocks. Tool call args arrive as a pre-assembled JSON string (not streamed
 * as deltas), which simplifies parsing considerably.
 *
 * Translation responsibilities:
 *   - `NormalizedMessage[]` → OpenAI-style `ChatCompletionMessageParam[]`
 *   - `NormalizedTool[]`    → OpenAI-style `ChatCompletionTool[]`
 *   - Streamed `chat.completions.create` chunks → {@link LLMEvent}s
 */
import Groq from 'groq-sdk';
import type {
  LLMEvent,
  LLMProvider,
  LLMChatRequest,
  NormalizedMessage,
  NormalizedTool,
} from './llm-provider.js';
import { withBackoff } from './backoff.js';

/**
 * Default model. Groq deprecated `llama-3.3-70b-versatile` on 2026-08-16
 * (free/developer tier); `openai/gpt-oss-120b` is Groq's recommended
 * successor — an open-weight model purpose-built for agentic/tool-use
 * workloads, which fits this app's tool-calling agent well.
 */
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
/** Token cap — generous enough for multi-hop tool chains. */
const DEFAULT_MAX_TOKENS = 2048;

/** Construction-time options for the Groq provider. */
export interface GroqProviderOptions {
  apiKey: string;
  /** Model ID. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  /** Per-turn `max_tokens`. Defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
}

/**
 * Build a Groq-backed {@link LLMProvider}.
 *
 * @throws If `apiKey` is empty — fail fast at startup rather than per-request.
 *
 * @example
 * ```ts
 * const provider = createGroqProvider({ apiKey: process.env.GROQ_API_KEY! });
 * for await (const evt of provider.chat({ system, messages, tools })) { ... }
 * ```
 */
export function createGroqProvider(opts: GroqProviderOptions): LLMProvider {
  if (!opts.apiKey) throw new Error('GroqProvider: missing apiKey');
  const client = new Groq({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    name: `groq:${model}`,
    chat(req) {
      return streamGroq(client, model, maxTokens, req);
    },
  };
}

/** Async generator that yields normalised events from one Groq turn. */
async function* streamGroq(
  client: Groq,
  model: string,
  maxTokens: number,
  req: LLMChatRequest,
): AsyncIterable<LLMEvent> {
  const stream = await withBackoff(() =>
    client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      stream: true,
      messages: toGroqMessages(req.system, req.messages),
      tools: req.tools.length ? req.tools.map(toGroqTool) : undefined,
      tool_choice: req.tools.length ? 'auto' : undefined,
    }),
  );

  // Groq streams tool call args as pre-assembled JSON in the first delta —
  // buffer by index until `finish_reason` signals the turn is complete.
  const toolBuffers = new Map<number, { id: string; name: string; args: string }>();
  let sawToolUse = false;

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    yield* processGroqChunk(choice, toolBuffers);
    if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
      for (const buf of toolBuffers.values()) {
        sawToolUse = true;
        yield { type: 'tool_call', id: buf.id, name: buf.name, args: parseJsonOrEmpty(buf.args) };
      }
    }
  }

  yield { type: 'stop', reason: sawToolUse ? 'tool_use' : 'end_turn' };
}

/** Yield text events and accumulate tool-call arg buffers for one stream chunk. */
function* processGroqChunk(
  choice: { delta: Groq.Chat.ChatCompletionChunk.Choice.Delta },
  toolBuffers: Map<number, { id: string; name: string; args: string }>,
): Generator<LLMEvent, void, void> {
  const { delta } = choice;
  if (delta.content) yield { type: 'text', delta: delta.content };
  for (const tc of delta.tool_calls ?? []) {
    const buf = toolBuffers.get(tc.index);
    if (!buf) {
      toolBuffers.set(tc.index, {
        id: tc.id ?? `groq-${tc.index}`,
        name: tc.function?.name ?? '',
        args: tc.function?.arguments ?? '',
      });
    } else {
      buf.args += tc.function?.arguments ?? '';
    }
  }
}

/**
 * Convert normalised messages into Groq/OpenAI `ChatCompletionMessageParam[]`.
 * The system prompt is prepended as a `system` role message.
 *
 * `NormalizedMessage` only carries the *result* side of a tool call
 * (`toolCallId`/`toolName` on the `role: 'tool'` message) — the orchestrator
 * never records a structured `tool_calls` array on the preceding assistant
 * message, since Gemini's and Anthropic's adapters don't need one. Groq's
 * `openai/gpt-oss-120b` does: its "harmony" prompt template requires every
 * tool-result message to trace back to a *named* `tool_calls` entry on the
 * assistant message immediately before it, or it fails with
 * `Tools should have a name!`. This reconstructs that pairing here — the
 * one place that needs it — rather than widening the shared
 * `NormalizedMessage` shape for every provider.
 *
 * The original call arguments aren't available at this layer (only the
 * result is threaded through history), so reconstructed `tool_calls` use a
 * placeholder `arguments: '{}'` — harmony only requires a name to resolve
 * the pairing, not the original arguments. One known fidelity gap: if the
 * model calls tools across two consecutive hops with no assistant text in
 * between either hop (both `assistantText` empty), those two hops' tool
 * calls get merged onto one synthetic assistant message rather than two —
 * harmless for rendering (every result still has a valid named call), just
 * not a perfect turn-by-turn reconstruction.
 *
 * @internal exported for testing.
 */
export function toGroqMessages(
  system: string,
  messages: NormalizedMessage[],
): Groq.Chat.ChatCompletionMessageParam[] {
  const result: Groq.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  // The assistant message currently accumulating tool_calls for the
  // in-progress run of tool results. Reset whenever a genuinely new
  // assistant/user message appears; reused across consecutive tool
  // messages from the same hop.
  let pendingToolCallAssistant: Groq.Chat.ChatCompletionAssistantMessageParam | null = null;

  for (const msg of messages) {
    if (msg.role === 'tool') {
      const toolCall: Groq.Chat.ChatCompletionMessageToolCall = {
        id: msg.toolCallId ?? '',
        type: 'function',
        function: { name: msg.toolName ?? 'unknown_tool', arguments: '{}' },
      };
      if (pendingToolCallAssistant) {
        pendingToolCallAssistant.tool_calls = [
          ...(pendingToolCallAssistant.tool_calls ?? []),
          toolCall,
        ];
      } else {
        pendingToolCallAssistant = { role: 'assistant', tool_calls: [toolCall] };
        result.push(pendingToolCallAssistant);
      }
      result.push({ role: 'tool', tool_call_id: msg.toolCallId ?? '', content: msg.content });
      continue;
    }

    pendingToolCallAssistant = null;
    if (msg.role === 'assistant') {
      const pushed: Groq.Chat.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: msg.content,
      };
      result.push(pushed);
      // Anticipate this hop's tool results (if any) attaching to this same
      // message, matching how the orchestrator interleaves them.
      pendingToolCallAssistant = pushed;
    } else {
      result.push({ role: 'user', content: msg.content });
    }
  }

  return result;
}

/** Convert one normalised tool definition to the OpenAI/Groq tool shape. */
function toGroqTool(t: NormalizedTool): Groq.Chat.ChatCompletionTool {
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
 * Groq occasionally emits an empty string for parameter-less tools.
 */
function parseJsonOrEmpty(s: string): unknown {
  if (!s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
