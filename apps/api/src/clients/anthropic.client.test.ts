import { toAnthropicMessages } from './anthropic.client.js';
import type { NormalizedMessage } from './llm-provider.js';

// ---------------------------------------------------------------------------
// Anthropic's Messages API requires every tool_result block to trace back to
// a tool_use block with a matching id on the preceding assistant message —
// the same requirement Groq's harmony template has (see groq.client.test.ts
// for the production incident this pattern was first found from).
// NormalizedMessage only carries the result side of a tool call, so this
// reconstructs the tool_use side. These tests assert the reconstruction
// directly, without touching the network or the Anthropic SDK.
// ---------------------------------------------------------------------------

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

describe('toAnthropicMessages', () => {
  it('attaches a named tool_use block to the assistant message preceding a tool result', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'What is the space weather?' },
      { role: 'assistant', content: 'Let me check.' },
      toolResult(),
    ];

    const result = toAnthropicMessages(messages);

    const assistant = result[1];
    if (assistant?.role !== 'assistant') throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    expect(assistant.content).toEqual([
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'call-1', name: 'get_space_weather', input: {} },
    ]);

    const toolResultMsg = result[2];
    expect(toolResultMsg).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call-1', content: '{"ok":true}', is_error: false },
      ],
    });
  });

  it('synthesizes an assistant message when the model produced no text before calling a tool', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'What is overhead right now?' },
      toolResult({ toolCallId: 'call-1', toolName: 'find_satellites_above' }),
    ];

    const result = toAnthropicMessages(messages);

    const assistant = result[1];
    if (assistant?.role !== 'assistant') throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    expect(assistant.content).toEqual([
      { type: 'tool_use', id: 'call-1', name: 'find_satellites_above', input: {} },
    ]);
  });

  it('groups multiple tool results from the same hop onto one assistant message', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'Check ISS position and telemetry.' },
      { role: 'assistant', content: 'On it.' },
      toolResult({ toolCallId: 'call-1', toolName: 'get_satellite_position' }),
      toolResult({ toolCallId: 'call-2', toolName: 'get_satellite_telemetry' }),
    ];

    const result = toAnthropicMessages(messages);

    const assistant = result[1];
    if (assistant?.role !== 'assistant' || !Array.isArray(assistant.content)) {
      throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    }
    const toolUseBlocks = assistant.content.filter((b) => b.type === 'tool_use');
    expect(toolUseBlocks).toHaveLength(2);
    expect(toolUseBlocks.map((b) => (b.type === 'tool_use' ? b.name : null))).toEqual([
      'get_satellite_position',
      'get_satellite_telemetry',
    ]);
  });

  it('starts a fresh assistant message for each subsequent hop', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'Multi-hop question.' },
      { role: 'assistant', content: 'Checking passes.' },
      toolResult({ toolCallId: 'call-1', toolName: 'predict_passes' }),
      { role: 'assistant', content: 'Now checking anomalies.' },
      toolResult({ toolCallId: 'call-2', toolName: 'get_anomalies' }),
    ];

    const result = toAnthropicMessages(messages);

    const firstAssistant = result[1];
    const secondAssistant = result[3];
    if (
      firstAssistant?.role !== 'assistant' ||
      !Array.isArray(firstAssistant.content) ||
      secondAssistant?.role !== 'assistant' ||
      !Array.isArray(secondAssistant.content)
    ) {
      throw new Error('expected assistant messages');
    }
    expect(
      firstAssistant.content.some((b) => b.type === 'tool_use' && b.name === 'predict_passes'),
    ).toBe(true);
    expect(
      secondAssistant.content.some((b) => b.type === 'tool_use' && b.name === 'get_anomalies'),
    ).toBe(true);
  });

  it('marks the tool_result block as an error when the tool call failed', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'q' },
      toolResult({ isError: true, content: 'boom' }),
    ];

    const result = toAnthropicMessages(messages);

    const toolResultMsg = result[2];
    expect(toolResultMsg).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'boom', is_error: true }],
    });
  });

  it('falls back to "unknown_tool" when toolName is missing', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: 'q' },
      toolResult({ toolName: undefined }),
    ];

    const result = toAnthropicMessages(messages);

    const assistant = result[1];
    if (assistant?.role !== 'assistant' || !Array.isArray(assistant.content)) {
      throw new Error(EXPECTED_ASSISTANT_MESSAGE);
    }
    const block = assistant.content[0];
    expect(block?.type === 'tool_use' ? block.name : null).toBe('unknown_tool');
  });
});
