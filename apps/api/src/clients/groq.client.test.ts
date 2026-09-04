import { toGroqMessages } from './groq.client.js';
import type { NormalizedMessage } from './llm-provider.js';

// ---------------------------------------------------------------------------
// Regression suite for a real production incident: Groq's openai/gpt-oss-120b
// ("harmony" prompt template) rejected every multi-hop tool conversation with
// `Tools should have a name!` because NormalizedMessage only carries the
// *result* side of a tool call (toolCallId/toolName) — nothing reconstructed
// a `tool_calls` entry on the preceding assistant message the way OpenAI's
// wire format requires. These tests assert the reconstruction directly,
// without touching the network or the Groq SDK.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = 'system prompt';
const EXPECTED_ASSISTANT_MESSAGE = 'expected assistant message';

function toolResult(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    role: 'tool',
    content: '{"ok":true}',
    toolCallId: 'call-1',
    toolName: 'get_space_weather',
    ...overrides,
  };
}

describe('toGroqMessages', () => {
  it('attaches a named tool_calls entry to the assistant message preceding a tool result', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'What is the space weather?' },
      { role: 'assistant', content: 'Let me check.' },
      toolResult(),
    ];

    const result = toGroqMessages(SYSTEM_PROMPT, messages);

    const assistant = result[2];
    expect(assistant?.role).toBe('assistant');
    if (assistant?.role !== 'assistant') throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    expect(assistant.content).toBe('Let me check.');
    expect(assistant.tool_calls).toEqual([
      { id: 'call-1', type: 'function', function: { name: 'get_space_weather', arguments: '{}' } },
    ]);

    const toolMsg = result[3];
    expect(toolMsg).toEqual({ role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' });
  });

  it('synthesizes an assistant message when the model produced no text before calling a tool', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'What is overhead right now?' },
      toolResult({ toolCallId: 'call-1', toolName: 'find_satellites_above' }),
    ];

    const result = toGroqMessages(SYSTEM_PROMPT, messages);

    const assistant = result[2];
    if (assistant?.role !== 'assistant') throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    expect(assistant.content).toBeUndefined();
    expect(assistant.tool_calls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'find_satellites_above', arguments: '{}' },
      },
    ]);
  });

  it('groups multiple tool results from the same hop onto one assistant message', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'Check ISS position and telemetry.' },
      { role: 'assistant', content: 'On it.' },
      toolResult({ toolCallId: 'call-1', toolName: 'get_satellite_position' }),
      toolResult({ toolCallId: 'call-2', toolName: 'get_satellite_telemetry' }),
    ];

    const result = toGroqMessages(SYSTEM_PROMPT, messages);

    const assistant = result[2];
    if (assistant?.role !== 'assistant') throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    expect(assistant.tool_calls).toHaveLength(2);
    expect(assistant.tool_calls?.map((tc) => tc.function.name)).toEqual([
      'get_satellite_position',
      'get_satellite_telemetry',
    ]);
    // Two tool results, each its own message, both after the one assistant message.
    expect(result).toHaveLength(5); // system + user + assistant + 2 tool
  });

  it('starts a fresh assistant message for each subsequent hop', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'Multi-hop question.' },
      { role: 'assistant', content: 'Checking passes.' },
      toolResult({ toolCallId: 'call-1', toolName: 'predict_passes' }),
      { role: 'assistant', content: 'Now checking anomalies.' },
      toolResult({ toolCallId: 'call-2', toolName: 'get_anomalies' }),
    ];

    const result = toGroqMessages(SYSTEM_PROMPT, messages);

    const firstAssistant = result[2];
    const secondAssistant = result[4];
    if (firstAssistant?.role !== 'assistant' || secondAssistant?.role !== 'assistant') {
      throw new Error('expected assistant messages');
    }
    expect(firstAssistant.tool_calls?.map((tc) => tc.function.name)).toEqual(['predict_passes']);
    expect(secondAssistant.tool_calls?.map((tc) => tc.function.name)).toEqual(['get_anomalies']);
  });

  it('falls back to "unknown_tool" when toolName is missing', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'q' },
      toolResult({ toolName: undefined }),
    ];

    const result = toGroqMessages(SYSTEM_PROMPT, messages);

    const assistant = result[2];
    if (assistant?.role !== 'assistant') throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    expect(assistant.tool_calls?.[0]?.function.name).toBe('unknown_tool');
  });
});
