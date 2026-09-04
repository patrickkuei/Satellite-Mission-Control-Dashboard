/**
 * AgentChatPanel — natural-language interface to the mission-control agent.
 *
 * Presentational shell over {@link useAgentChat}. The hook owns all state
 * and the SSE lifecycle; this component just renders the transcript, the
 * tool-call chips, and the input box.
 *
 * Mounted as a collapsible drawer in the right rail; the parent decides
 * whether it's visible. Inline `useEffect`s here are limited to DOM
 * concerns (autoscroll, focus) — anything stateful belongs in the hook.
 */
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatSession } from '../hooks/useChatSession';
import type { ChatMessage } from '../hooks/useAgentChat';
import { useSystemStatus } from '../stores/systemStatus';
import { ChatHistoryList } from './ChatHistoryList';
import styles from './AgentChatPanel.module.css';

/** Width bounds for the resizable panel (px). */
const MIN_WIDTH = 320;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 380;

/** Renders markdown links as new-tab external links — assistant text may cite NOAA/Celestrak sources. */
function MarkdownLink(props: AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

/**
 * Human-readable labels for tool names shown in the chip strip.
 * Raw snake_case names are meaningful to engineers but opaque to interviewers.
 */
const TOOL_LABELS: Record<string, string> = {
  get_satellite_position: 'Fetching satellite position',
  predict_passes: 'Predicting passes',
  get_space_weather: 'Checking space weather',
  get_satellite_telemetry: 'Reading telemetry',
  get_anomalies: 'Scanning for anomalies',
  find_satellites_above: 'Finding overhead satellites',
};

/**
 * Suggested prompts displayed when the transcript is empty. Each one
 * exercises a multi-hop tool chain documented in the Phase 4 brief.
 */
const SUGGESTIONS: ReadonlyArray<string> = [
  'What is the current space weather?',
  'Predict ISS passes over Tokyo in the next 6 hours.',
  'Which tracked satellites are overhead in San Francisco right now?',
  'Any anomalies on the ISS in the last 30 minutes?',
];

export interface AgentChatPanelProps {
  /** Whether the panel is rendered (parent controls open/close). */
  open: boolean;
  /** Close handler — fires when the user clicks the X. */
  onClose: () => void;
}

export function AgentChatPanel({ open, onClose }: AgentChatPanelProps): JSX.Element | null {
  const {
    messages,
    streaming,
    thinking,
    error,
    send,
    stop,
    retry,
    threads,
    activeThreadId,
    newThread,
    selectThread,
    deleteThread,
  } = useChatSession();
  const { serverDown } = useSystemStatus();
  const [input, setInput] = useState('');
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragStartX = useRef<number | null>(null);
  const dragStartWidth = useRef(DEFAULT_WIDTH);

  const onDragStart = useCallback(
    (e: ReactMouseEvent) => {
      dragStartX.current = e.clientX;
      dragStartWidth.current = width;

      const onMove = (ev: MouseEvent) => {
        if (dragStartX.current === null) return;
        // Panel is right-anchored — dragging left (negative delta) widens it.
        const delta = dragStartX.current - ev.clientX;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
        setWidth(next);
      };

      const onUp = () => {
        dragStartX.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [width],
  );

  // Pin to bottom on every new chunk; users scroll up to break out. Skipped
  // while history is open — the .scroll container renders ChatHistoryList
  // then, not the transcript, and a background stream could still be
  // updating `messages` behind it.
  useEffect(() => {
    if (historyOpen) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming, historyOpen]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  function submit(text: string): void {
    if (!text.trim() || streaming) return;
    send(text);
    setInput('');
  }

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    submit(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  }

  return (
    <aside className={styles.panel} style={{ width }} aria-label="Mission control assistant">
      <div className={styles.dragHandle} onMouseDown={onDragStart} aria-hidden="true" />
      <header className={styles.header}>
        <span className={styles.title}>assistant</span>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={`${styles.historyToggle} ${historyOpen ? styles.active : ''}`}
            onClick={() => setHistoryOpen((o) => !o)}
            aria-label="Conversation history"
            aria-pressed={historyOpen}
            title="Conversation history"
          >
            ☰
          </button>
          <button
            type="button"
            className={styles.newSession}
            onClick={() => {
              newThread();
              setHistoryOpen(false);
            }}
            disabled={streaming}
            aria-label="New session"
            title="New session"
          >
            +
          </button>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </header>

      <div className={styles.scroll} ref={scrollRef}>
        {historyOpen ? (
          <ChatHistoryList
            threads={threads}
            activeThreadId={activeThreadId}
            onSelect={(id) => {
              selectThread(id);
              setHistoryOpen(false);
            }}
            onDelete={deleteThread}
          />
        ) : messages.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Ask the mission-control agent.</p>
            <ul className={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => submit(s)} className={styles.suggestion}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((m, i) => (
            <MessageRow
              key={m.id}
              message={m}
              showRetry={!streaming && m.role === 'assistant' && i === messages.length - 1}
              onRetry={retry}
            />
          ))
        )}
        {!historyOpen && thinking && <div className={styles.thinking}>thinking…</div>}
        {!historyOpen && error && <div className={styles.error}>{error}</div>}
      </div>

      {!historyOpen && serverDown && (
        <div className={styles.agentOffline}>AGENT OFFLINE — uplink required</div>
      )}
      {!historyOpen && (
        <form className={styles.form} onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              serverDown
                ? 'Unavailable while server starts…'
                : streaming
                  ? 'streaming…'
                  : 'Ask about satellites, weather, anomalies…'
            }
            disabled={streaming || serverDown}
            rows={2}
          />
          {streaming ? (
            <button
              type="button"
              className={styles.stopBtn}
              onClick={stop}
              aria-label="Stop generation"
            >
              ■
            </button>
          ) : (
            <button
              type="submit"
              className={styles.send}
              disabled={!input.trim() || serverDown}
              aria-label="Send"
            >
              ↵
            </button>
          )}
        </form>
      )}
    </aside>
  );
}

interface MessageRowProps {
  message: ChatMessage;
  /** Show the retry action below this message. */
  showRetry: boolean;
  onRetry: () => void;
}

/**
 * One transcript row. Tool chips render above the body when present.
 *
 * Memoized: dragging the resize handle re-renders {@link AgentChatPanel} on
 * every `mousemove` tick (via its `width` state), and without this, every
 * message would re-render too — including a full markdown re-parse of every
 * assistant response on every tick. `message` keeps a stable reference
 * across unrelated re-renders (`useAgentChat`'s `setMessages` only replaces
 * the object for the message actually being updated) and `onRetry` is
 * already a stable `useCallback`, so memoization actually holds here.
 */
const MessageRow = memo(function MessageRow({
  message,
  showRetry,
  onRetry,
}: MessageRowProps): JSX.Element {
  return (
    <div className={`${styles.message} ${styles[message.role]}`}>
      {message.toolCalls.length > 0 && (
        <div className={styles.toolChips}>
          {message.toolCalls.map((tc, i) => {
            const chipClass = styles[chipClassKey(tc.status)];
            return (
              <span key={`${tc.name}-${i}`} className={`${styles.chip} ${chipClass}`}>
                {statusGlyph(tc.status)} {TOOL_LABELS[tc.name] ?? tc.name}
              </span>
            );
          })}
        </div>
      )}
      {message.content &&
        (message.role === 'assistant' ? (
          <div className={styles.body}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MarkdownLink }}>
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className={styles.body}>{message.content}</div>
        ))}
      {showRetry && (
        <button type="button" className={styles.retryBtn} onClick={onRetry} aria-label="Retry">
          ↺ Retry
        </button>
      )}
    </div>
  );
});

function chipClassKey(
  status: 'running' | 'ok' | 'error',
): 'chip_running' | 'chip_ok' | 'chip_error' {
  if (status === 'running') return 'chip_running';
  if (status === 'ok') return 'chip_ok';
  return 'chip_error';
}

function statusGlyph(status: 'running' | 'ok' | 'error'): string {
  if (status === 'running') return '…';
  if (status === 'ok') return '✓';
  return '✗';
}
