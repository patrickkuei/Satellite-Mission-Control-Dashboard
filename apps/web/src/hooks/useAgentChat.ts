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
import { useSelectedSatellite } from '../stores/selectedSatellite';

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
  | { type: 'select_satellite'; noradId: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Hook return shape. */
export interface AgentChat {
  messages: ChatMessage[];
  /** True while an assistant response is streaming. */
  streaming: boolean;
  /**
   * True when streaming but waiting on the LLM (no text or tool chip has
   * arrived yet, or the last tool just finished and the next turn hasn't
   * started). Used to show a "thinking…" indicator.
   */
  thinking: boolean;
  /** Last error from the stream (transport or model). Cleared on next send. */
  error: string | null;
  /** Send `text` as a user message and start a new streamed response. */
  send: (text: string) => void;
  /** Abort the current stream without clearing the transcript. */
  stop: () => void;
  /**
   * Re-send the last user message, replacing the last assistant response.
   * No-op if there is no prior exchange or if streaming is in progress.
   */
  retry: () => void;
  /** Clear the conversation and start a fresh session. */
  reset: () => void;
}

/** Endpoint — proxied by Vite to `apps/api`. */
import { apiBase } from '../api/config';
const AGENT_ENDPOINT = `${apiBase}/agent/chat`;

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
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Ref kept in sync with messages so callbacks with empty dep arrays always
  // read the current list without needing to re-create on every render.
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  // Cancel any in-flight stream when the hook unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStreaming(false);
    setThinking(false);
    setError(null);
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

    // Read current messages via ref — avoids stale closure from empty dep array.
    const history = buildHistory(messagesRef.current);

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);
    setThinking(true);
    setError(null);

    void runStream(trimmed, history, controller.signal, assistantId, setMessages, setThinking)
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setError((err as Error).message);
      })
      .finally(() => {
        setStreaming(false);
        setThinking(false);
      });
  }, []);

  const retry = useCallback(() => {
    const current = messagesRef.current;
    // Find the last user message — that's what we re-send.
    const lastUserIdx = [...current].reverse().findIndex((m) => m.role === 'user');
    if (lastUserIdx === -1) return;
    const userMsgIdx = current.length - 1 - lastUserIdx;
    const userMsg = current[userMsgIdx];
    if (!userMsg) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // History = everything before the last user message (exclude the failed assistant reply).
    const history = buildHistory(current.slice(0, userMsgIdx));

    const assistantId = `a-${Date.now()}`;
    const freshAssistant: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolCalls: [],
    };

    // Replace everything from the last user message onward with a fresh assistant slot.
    setMessages((prev) => [...prev.slice(0, userMsgIdx + 1), freshAssistant]);
    setStreaming(true);
    setThinking(true);
    setError(null);

    void runStream(
      userMsg.content,
      history,
      controller.signal,
      assistantId,
      setMessages,
      setThinking,
    )
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setError((err as Error).message);
      })
      .finally(() => {
        setStreaming(false);
        setThinking(false);
      });
  }, []);

  return { messages, streaming, thinking, error, send, stop, retry, reset };
}

/** Serialisable turn for the history payload. */
interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Extract completed user/assistant turns from the message list.
 * Skips assistant messages with no content (still streaming) and tool-call
 * metadata — the backend only needs the human-readable transcript.
 */
function buildHistory(messages: ChatMessage[]): HistoryTurn[] {
  return messages
    .filter((m) => m.content.trim() !== '')
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Drive one SSE stream from start to `done` (or abort). Mutates the
 * assistant message identified by `assistantId` via `setMessages` as each
 * event arrives. Split out of {@link useAgentChat} to keep that function
 * under the cognitive-complexity cap.
 */
async function runStream(
  message: string,
  history: HistoryTurn[],
  signal: AbortSignal,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setThinking: React.Dispatch<React.SetStateAction<boolean>>,
): Promise<void> {
  const response = await fetch(AGENT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message, history }),
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
      if (evt) applyEvent(evt, assistantId, setMessages, setThinking);
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
  setThinking: React.Dispatch<React.SetStateAction<boolean>>,
): void {
  if (evt.type === 'done') return;
  // Highlight the relevant satellite on the globe without touching message state.
  if (evt.type === 'select_satellite') {
    useSelectedSatellite.getState().setSelected(evt.noradId);
    return;
  }
  // Any content arriving means the LLM is no longer in a silent gap.
  if (evt.type === 'text' || evt.type === 'tool_start') setThinking(false);
  // After a tool ends, LLM enters another silent gap before the next turn.
  if (evt.type === 'tool_end') setThinking(true);
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
