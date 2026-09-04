import { toMistralMessages } from './mistral.client.js';
import type { NormalizedMessage } from './llm-provider.js';

// ---------------------------------------------------------------------------
// Mistral's API requires every tool-response message to trace back to a
// named tool call on the preceding assistant message — the same requirement
// Groq's harmony template and Anthropic's Messages API have (see
// groq.client.test.ts for the production incident this pattern was first
// found from). NormalizedMessage only carries the result side of a tool
// call, so this reconstructs the call side proactively. These tests assert
// the reconstruction directly, without touching the network or the SDK.
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

describe('toMistralMessages', () => {
  it('prepends the system prompt as a system-role message', () => {
    const result = toMistralMessages(SYSTEM_PROMPT, []);
    expect(result).toEqual([{ role: 'system', content: 'system prompt' }]);
  });

  it('attaches a named tool call to the assistant message preceding a tool result', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'What is the space weather?' },
      { role: 'assistant', content: 'Let me check.' },
      toolResult(),
    ];

    const result = toMistralMessages(SYSTEM_PROMPT, messages);

    const assistant = result[2];
    if (assistant?.role !== 'assistant') throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    expect(assistant.content).toBe('Let me check.');
    expect(assistant.toolCalls).toEqual([
      { id: 'call-1', type: 'function', function: { name: 'get_space_weather', arguments: '{}' } },
    ]);

    const toolMsg = result[3];
    expect(toolMsg).toEqual({
      role: 'tool',
      content: '{"ok":true}',
      toolCallId: 'call-1',
      name: 'get_space_weather',
    });
  });

  it('synthesizes an assistant message when the model produced no text before calling a tool', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'What is overhead right now?' },
      toolResult({ toolCallId: 'call-1', toolName: 'find_satellites_above' }),
    ];

    const result = toMistralMessages(SYSTEM_PROMPT, messages);

    const assistant = result[2];
    if (assistant?.role !== 'assistant') throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    expect(assistant.content).toBeUndefined();
    expect(assistant.toolCalls).toEqual([
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

    const result = toMistralMessages(SYSTEM_PROMPT, messages);

    const assistant = result[2];
    if (assistant?.role !== 'assistant') throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    expect(assistant.toolCalls).toHaveLength(2);
    expect(assistant.toolCalls?.map((tc) => tc.function.name)).toEqual([
      'get_satellite_position',
      'get_satellite_telemetry',
    ]);
    expect(result).toHaveLength(5); // system + user + assistant + 2 tool responses
  });

  it('starts a fresh assistant message for each subsequent hop', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'Multi-hop question.' },
      { role: 'assistant', content: 'Checking passes.' },
      toolResult({ toolCallId: 'call-1', toolName: 'predict_passes' }),
      { role: 'assistant', content: 'Now checking anomalies.' },
      toolResult({ toolCallId: 'call-2', toolName: 'get_anomalies' }),
    ];

    const result = toMistralMessages(SYSTEM_PROMPT, messages);

    const firstAssistant = result[2];
    const secondAssistant = result[4];
    if (firstAssistant?.role !== 'assistant' || secondAssistant?.role !== 'assistant') {
      throw new Error('expected assistant messages');
    }
    expect(firstAssistant.toolCalls?.map((tc) => tc.function.name)).toEqual(['predict_passes']);
    expect(secondAssistant.toolCalls?.map((tc) => tc.function.name)).toEqual(['get_anomalies']);
  });

  it('falls back to "unknown_tool" when toolName is missing', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'q' },
      toolResult({ toolName: undefined }),
    ];

    const result = toMistralMessages(SYSTEM_PROMPT, messages);

    const assistant = result[2];
    if (assistant?.role !== 'assistant') throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    expect(assistant.toolCalls?.[0]?.function.name).toBe('unknown_tool');

    const toolMsg = result[3];
    expect(toolMsg).toMatchObject({ name: 'unknown_tool' });
  });
});
