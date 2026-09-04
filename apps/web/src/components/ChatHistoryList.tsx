/**
 * ChatHistoryList — browse/switch/delete saved agent-chat conversations.
 *
 * Presentational only; no internal state. Rendered inside
 * {@link AgentChatPanel} in place of the transcript when the panel's
 * history toggle is open.
 */
import { useMemo } from 'react';
import type { ChatThread } from '../stores/chatHistory';
import styles from './ChatHistoryList.module.css';

/** Props for {@link ChatHistoryList}. */
export interface ChatHistoryListProps {
  /** Saved conversations, unsorted — this component sorts by `updatedAt`. */
  threads: ChatThread[];
  /** Id of the currently active thread, or `null`. Drives the highlighted row. */
  activeThreadId: string | null;
  /** Fired when a row is clicked. */
  onSelect: (id: string) => void;
  /** Fired when a row's delete button is clicked. */
  onDelete: (id: string) => void;
}

/**
 * Render the saved-conversation list, newest first.
 *
 * @example
 * ```tsx
 * <ChatHistoryList threads={threads} activeThreadId={activeThreadId} onSelect={selectThread} onDelete={deleteThread} />
 * ```
 */
export function ChatHistoryList({
  threads,
  activeThreadId,
  onSelect,
  onDelete,
}: ChatHistoryListProps): JSX.Element {
  const sorted = useMemo(
    () => [...threads].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [threads],
  );

  if (sorted.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No saved conversations yet.</p>
      </div>
    );
  }

  return (
    <ul className={styles.list}>
      {sorted.map((thread) => (
        <li key={thread.id}>
          <button
            type="button"
            className={`${styles.row} ${thread.id === activeThreadId ? styles.active : ''}`}
            onClick={() => onSelect(thread.id)}
          >
            <span className={styles.title}>{thread.title}</span>
            <span className={styles.time}>{formatThreadTime(thread.updatedAt)}</span>
          </button>
          <button
            type="button"
            className={styles.delete}
            aria-label={`Delete "${thread.title}"`}
            onClick={() => onDelete(thread.id)}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Absolute UTC date + time — unlike {@link AlertLog}'s bare `HH:MM:SSZ`,
 * saved conversations can be days old, so the date is included.
 */
function formatThreadTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toISOString().slice(0, 10);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}Z`;
}
