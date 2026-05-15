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
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAgentChat, type ChatMessage } from '../hooks/useAgentChat';
import styles from './AgentChatPanel.module.css';

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
  const { messages, streaming, error, send } = useAgentChat();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Pin to bottom on every new chunk; users scroll up to break out.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

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
    <aside className={styles.panel} aria-label="Mission control assistant">
      <header className={styles.header}>
        <span className={styles.title}>assistant</span>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className={styles.scroll} ref={scrollRef}>
        {messages.length === 0 ? (
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
          messages.map((m) => <MessageRow key={m.id} message={m} />)
        )}
        {error && <div className={styles.error}>{error}</div>}
      </div>

      <form className={styles.form} onSubmit={onSubmit}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={streaming ? 'streaming…' : 'Ask about satellites, weather, anomalies…'}
          disabled={streaming}
          rows={2}
        />
        <button
          type="submit"
          className={styles.send}
          disabled={streaming || !input.trim()}
          aria-label="Send"
        >
          ↵
        </button>
      </form>
    </aside>
  );
}

/** One transcript row. Tool chips render above the body when present. */
function MessageRow({ message }: { message: ChatMessage }): JSX.Element {
  return (
    <div className={`${styles.message} ${styles[message.role]}`}>
      {message.toolCalls.length > 0 && (
        <div className={styles.toolChips}>
          {message.toolCalls.map((tc, i) => {
            const chipClass = styles[chipClassKey(tc.status)];
            return (
              <span key={`${tc.name}-${i}`} className={`${styles.chip} ${chipClass}`}>
                {statusGlyph(tc.status)} {tc.name}
              </span>
            );
          })}
        </div>
      )}
      {message.content && <div className={styles.body}>{message.content}</div>}
    </div>
  );
}

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
