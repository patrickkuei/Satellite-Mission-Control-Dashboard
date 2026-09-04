/**
 * Zustand store for saved agent-chat conversations, persisted to
 * `localStorage`.
 *
 * Owns the list of saved threads and which one is active. Pure synchronous
 * state — no streaming/SSE awareness lives here; {@link useAgentChat} owns
 * the live transcript, and `useChatSession` bridges the two by calling
 * {@link ChatHistoryState.recordTurn} once a turn settles.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ChatMessage } from '../hooks/useAgentChat';

/** Maximum saved conversations kept in storage; oldest is evicted past this. */
const MAX_THREADS = 30;
/** Thread titles are derived from the first user message, truncated to this length. */
const TITLE_MAX_LENGTH = 40;

/** One saved conversation. */
export interface ChatThread {
  id: string;
  /** Derived once, at creation, from the first user message — never changes after. */
  title: string;
  messages: ChatMessage[];
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp — bumped on every {@link ChatHistoryState.recordTurn} call. */
  updatedAt: string;
}

/** Public surface of the chat-history store. */
export interface ChatHistoryState {
  /** Saved conversations, unsorted (callers sort by `updatedAt` for display). */
  threads: ChatThread[];
  /** Id of the conversation currently loaded in the live chat panel, or `null`. */
  activeThreadId: string | null;
  /**
   * Record the outcome of one settled turn. Creates a new thread if
   * `activeThreadId` is unset or points at a thread that no longer exists
   * (self-heals a stale pointer); otherwise upserts the existing thread's
   * `messages`/`updatedAt` — title is never touched on the upsert path.
   * Call once per settled turn, never per streamed delta.
   */
  recordTurn(messages: ChatMessage[]): void;
  /** Point the active thread at an existing saved conversation. */
  selectThread(id: string): void;
  /** Remove a saved conversation. Clears `activeThreadId` if it was the active one. */
  deleteThread(id: string): void;
  /** Detach from the active thread without touching its persisted data. */
  startNewThread(): void;
}

/** Same inline id scheme as `stores/toasts.ts` — no uuid dependency for this. */
function generateThreadId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** First user message, trimmed and truncated to {@link TITLE_MAX_LENGTH}. */
function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  const text = firstUser?.content.trim() || 'New conversation';
  return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH)}…` : text;
}

/** Evict the oldest thread by `updatedAt`, never the active one. */
function evictOldest(threads: ChatThread[], activeThreadId: string | null): ChatThread[] {
  if (threads.length <= MAX_THREADS) return threads;
  const evictable = threads.filter((t) => t.id !== activeThreadId);
  const oldest = evictable.reduce((a, b) => (a.updatedAt < b.updatedAt ? a : b));
  return threads.filter((t) => t.id !== oldest.id);
}

/**
 * Hook-style accessor for the chat-history store. Persisted to `localStorage`
 * under `orbit-ctrl.chatHistory`.
 *
 * @example
 * ```ts
 * const { threads, recordTurn } = useChatHistory();
 * recordTurn(messages); // called once a turn settles, not per streamed delta
 * ```
 */
export const useChatHistory = create<ChatHistoryState>()(
  persist(
    (set, get) => ({
      threads: [],
      activeThreadId: null,

      recordTurn(messages) {
        const { threads, activeThreadId } = get();
        const now = new Date().toISOString();
        const existing = activeThreadId ? threads.find((t) => t.id === activeThreadId) : undefined;

        if (existing) {
          set({
            threads: threads.map((t) =>
              t.id === existing.id ? { ...t, messages, updatedAt: now } : t,
            ),
          });
          return;
        }

        const created: ChatThread = {
          id: generateThreadId(),
          title: deriveTitle(messages),
          messages,
          createdAt: now,
          updatedAt: now,
        };
        set({
          threads: evictOldest([...threads, created], created.id),
          activeThreadId: created.id,
        });
      },

      selectThread(id) {
        set({ activeThreadId: id });
      },

      deleteThread(id) {
        set((state) => ({
          threads: state.threads.filter((t) => t.id !== id),
          activeThreadId: state.activeThreadId === id ? null : state.activeThreadId,
        }));
      },

      startNewThread() {
        set({ activeThreadId: null });
      },
    }),
    {
      name: 'orbit-ctrl.chatHistory',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
