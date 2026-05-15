/**
 * Gemini adapter — implements {@link LLMProvider} on top of `@google/genai`.
 *
 * Primary provider for the demo. Picked for the generous free tier (the
 * portfolio site has to keep running without an Anthropic budget) and to
 * exercise the {@link LLMProvider} abstraction against a deliberately
 * different SDK shape than Anthropic's.
 *
 * Translation responsibilities:
 *   - `NormalizedTool[]` → `FunctionDeclaration[]`. Strips JSON Schema
 *     features Gemini doesn't accept (`additionalProperties`, `$ref`,
 *     `oneOf`) via {@link toGeminiSchema}.
 *   - `NormalizedMessage[]` → `Content[]`. Note Gemini uses `user`/`model`
 *     roles; tool *calls* are emitted by `model` and tool *results* are
 *     sent as `user` messages with `functionResponse` parts.
 *   - `models.generateContentStream(...)` event chunks → {@link LLMEvent}s.
 */
import { GoogleGenAI, type GenerateContentResponse, type Part } from '@google/genai';
import type { LLMEvent, LLMProvider, LLMChatRequest, NormalizedMessage } from './llm-provider.js';
import { withBackoff } from './backoff.js';

/** Default Gemini model. 2.5-flash is free-tier-friendly and tool-calling-capable. */
const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Construction-time options for the Gemini provider. */
export interface GeminiProviderOptions {
  apiKey: string;
  /** Model ID. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
}

/**
 * Build a Gemini-backed {@link LLMProvider}.
 *
 * @throws If `apiKey` is empty — fail fast at startup rather than per-request.
 *
 * @example
 * ```ts
 * const provider = createGeminiProvider({ apiKey: process.env.GEMINI_API_KEY! });
 * for await (const evt of provider.chat({ system, messages, tools })) { ... }
 * ```
 */
export function createGeminiProvider(opts: GeminiProviderOptions): LLMProvider {
  if (!opts.apiKey) throw new Error('GeminiProvider: missing apiKey');
  const client = new GoogleGenAI({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;

  return {
    name: `gemini:${model}`,
    chat(req) {
      return streamGemini(client, model, req);
    },
  };
}

/** Async generator that yields normalized events from one Gemini turn. */
async function* streamGemini(
  client: GoogleGenAI,
  model: string,
  req: LLMChatRequest,
): AsyncIterable<LLMEvent> {
  const contents = toGeminiContents(req.messages);
  const functionDeclarations = req.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toGeminiSchema(t.inputSchema) as Record<string, unknown>,
  }));

  const stream = await withBackoff(() =>
    client.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: req.system,
        tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
      },
    }),
  );

  let toolCallCounter = 0;
  let sawToolUse = false;

  for await (const chunk of stream as AsyncIterable<GenerateContentResponse>) {
    for (const evt of partsToEvents(chunk, () => `gem-${++toolCallCounter}`)) {
      if (evt.type === 'tool_call') sawToolUse = true;
      yield evt;
    }
  }

  yield { type: 'stop', reason: sawToolUse ? 'tool_use' : 'end_turn' };
}

/** Walk a streaming chunk's parts and emit `text`/`tool_call` events. */
function* partsToEvents(chunk: GenerateContentResponse, nextId: () => string): Iterable<LLMEvent> {
  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (typeof part.text === 'string' && part.text.length > 0) {
      yield { type: 'text', delta: part.text };
    } else if (part.functionCall && typeof part.functionCall.name === 'string') {
      yield {
        type: 'tool_call',
        id: nextId(),
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      };
    }
  }
}

/**
 * Convert normalized messages into Gemini's `Content[]` format.
 *
 * Mapping:
 *   - `user`      → `{ role: 'user', parts: [{ text }] }`
 *   - `assistant` → `{ role: 'model', parts: [{ text }] }`
 *   - `tool`      → `{ role: 'user', parts: [{ functionResponse }] }`
 *     (Gemini treats tool results as a follow-up user turn.)
 */
function toGeminiContents(messages: NormalizedMessage[]): Array<{ role: string; parts: Part[] }> {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      return {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: msg.toolName ?? 'unknown_tool',
              response: { content: msg.content, isError: Boolean(msg.isError) },
            },
          },
        ],
      };
    }
    return {
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    };
  });
}

/**
 * Normalize a JSON Schema fragment so Gemini's function-declaration parser
 * accepts it. Gemini rejects schemas containing unsupported features rather
 * than ignoring them, so we strip them up front:
 *   - `additionalProperties` (not part of Gemini's subset)
 *   - `$ref` / `$defs`       (no schema-reference support)
 *   - `oneOf` / `anyOf` / `allOf` (no union/intersection support)
 *
 * Recursive on `properties` and `items` so nested-array element schemas are
 * normalized too.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (STRIP_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {};
      for (const [propKey, propVal] of Object.entries(value)) {
        props[propKey] = toGeminiSchema(propVal);
      }
      out[key] = props;
    } else if (key === 'items') {
      out[key] = toGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

const STRIP_KEYS = new Set([
  'additionalProperties',
  '$ref',
  '$defs',
  'definitions',
  'oneOf',
  'anyOf',
  'allOf',
  '$schema',
]);
