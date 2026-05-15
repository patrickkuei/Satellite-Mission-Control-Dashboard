/**
 * useAgentChat — owns the conversation state for the AI agent panel.
 *
 * One hook per chat panel; not a global store. The hook holds the rendered
 * message list, the streaming flag, and an in-flight `AbortController` so a
 * remounting panel cancels its open SSE stream instead of leaking it.
 *
 * Wire format: `POST /api/agent/chat` returns `text/event-stream` lines of
 * `data: <json>\n\n`, where each JSON object is an `AgentEvent` from
 * `apps/api/src/services/agent.service.ts`. We tolerate Windows newlines
 * and partial line splits because Node's SSE framing isn't guaranteed to
 * align with `TextDecoder` chunk boundaries.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Visible message in the chat transcript. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** Cumulative text — appended to as `text` deltas arrive. */
  content: string;
  /**
   * Tool calls observed during this assistant turn, in dispatch order.
   * Rendered inline above the message body as chips.
   */
  toolCalls: Array<{ name: string; status: 'running' | 'ok' | 'error' }>;
}

/** One event from the SSE stream — keep in sync with `AgentEvent` in the API. */
type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; isError: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Hook return shape. */
export interface AgentChat {
  messages: ChatMessage[];
  /** True while an assistant response is streaming. */
  streaming: boolean;
  /** Last error from the stream (transport or model). Cleared on next send. */
  error: string | null;
  /** Send `text` as a user message and start a new streamed response. */
  send: (text: string) => void;
}

/** Endpoint — proxied by Vite to `apps/api`. */
const AGENT_ENDPOINT = '/api/agent/chat';

/**
 * @example
 * ```tsx
 * const { messages, streaming, send } = useAgentChat();
 * send('what\'s overhead in Tokyo right now?');
 * ```
 */
export function useAgentChat(): AgentChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cancel any in-flight stream when the hook unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
      toolCalls: [],
    };
    const assistantId = `a-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolCalls: [],
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);
    setError(null);

    void runStream(trimmed, controller.signal, assistantId, setMessages)
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setError((err as Error).message);
      })
      .finally(() => {
        setStreaming(false);
      });
  }, []);

  return { messages, streaming, error, send };
}

/**
 * Drive one SSE stream from start to `done` (or abort). Mutates the
 * assistant message identified by `assistantId` via `setMessages` as each
 * event arrives. Split out of {@link useAgentChat} to keep that function
 * under the cognitive-complexity cap.
 */
async function runStream(
  message: string,
  signal: AbortSignal,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
): Promise<void> {
  const response = await fetch(AGENT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Agent request failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;

  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    const value = chunk.value;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const evt = parseSseBlock(block);
      if (evt) applyEvent(evt, assistantId, setMessages);
      separator = buffer.indexOf('\n\n');
    }
  }
}

/** Extract the JSON payload from one `data: ...` block, tolerating CR. */
function parseSseBlock(block: string): AgentEvent | null {
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      return JSON.parse(payload) as AgentEvent;
    } catch {
      return null;
    }
  }
  return null;
}

/** Apply one decoded event to the in-progress assistant message. */
function applyEvent(
  evt: AgentEvent,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
): void {
  if (evt.type === 'done') return;
  setMessages((prev) => prev.map((m) => (m.id === assistantId ? applyEventToMessage(m, evt) : m)));
}

function applyEventToMessage(msg: ChatMessage, evt: AgentEvent): ChatMessage {
  if (evt.type === 'text') {
    return { ...msg, content: msg.content + evt.delta };
  }
  if (evt.type === 'tool_start') {
    return { ...msg, toolCalls: [...msg.toolCalls, { name: evt.name, status: 'running' }] };
  }
  if (evt.type === 'tool_end') {
    return {
      ...msg,
      toolCalls: msg.toolCalls.map((tc, i) =>
        i === msg.toolCalls.length - 1 && tc.name === evt.name
          ? { ...tc, status: evt.isError ? 'error' : 'ok' }
          : tc,
      ),
    };
  }
  if (evt.type === 'error') {
    return { ...msg, content: msg.content + `\n\n⚠ ${evt.message}` };
  }
  return msg;
}
