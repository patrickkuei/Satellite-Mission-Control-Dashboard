/**
 * Groq adapter — implements {@link LLMProvider} on top of `groq-sdk`.
 *
 * Groq runs open-source models (Llama 3.3 70B by default) on custom
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

/** Default model. Llama 3.3 70B has solid tool-calling support on Groq free tier. */
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
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
 */
function toGroqMessages(
  system: string,
  messages: NormalizedMessage[],
): Groq.Chat.ChatCompletionMessageParam[] {
  const result: Groq.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        tool_call_id: msg.toolCallId ?? '',
        content: msg.content,
      });
    } else if (msg.role === 'assistant') {
      result.push({ role: 'assistant', content: msg.content });
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
