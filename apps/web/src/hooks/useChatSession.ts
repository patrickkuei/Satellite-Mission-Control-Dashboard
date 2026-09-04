/**
 * useChatSession — bridges the live chat transcript ({@link useAgentChat})
 * with persisted conversation history (the `chatHistory` store).
 *
 * Neither of those two knows about the other: `useAgentChat` only knows how
 * to stream/hold a message list, and the `chatHistory` store only knows how
 * to persist a list of threads. This hook is the seam — the `useEffect`s
 * that bridge them live here, per this project's rule that stateful effects
 * belong in a hook, never directly in a component.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAgentChat, type AgentChat, type ChatMessage } from './useAgentChat';
import { useChatHistory, type ChatThread } from '../stores/chatHistory';

/** Everything {@link useAgentChat} exposes, plus conversation-history controls. */
export interface ChatSession extends AgentChat {
  /** Saved conversations, unsorted — sort by `updatedAt` for display. */
  threads: ChatThread[];
  /** Id of the thread currently loaded into the live transcript, or `null`. */
  activeThreadId: string | null;
  /** Clear the live transcript and detach from any saved thread. */
  newThread: () => void;
  /** Load a saved conversation into the live transcript. */
  selectThread: (id: string) => void;
  /** Remove a saved conversation; if it was active, also clears the live transcript. */
  deleteThread: (id: string) => void;
}

/**
 * @example
 * ```tsx
 * const { messages, threads, selectThread, newThread } = useChatSession();
 * ```
 */
export function useChatSession(): ChatSession {
  const agent = useAgentChat();
  const threads = useChatHistory((s) => s.threads);
  const activeThreadId = useChatHistory((s) => s.activeThreadId);

  // `loadThread` changes `agent.messages` without any new content having
  // been produced (hydration on mount, or switching threads) — set right
  // before each such call so the sync effect below records it as already
  // up to date instead of bumping `updatedAt` and reordering the list for
  // a conversation nobody actually touched.
  const skipNextSync = useRef(false);

  // One-time hydration on mount: resume the last-active saved thread, if
  // any. `agent.loadThread` never changes identity (empty-dep useCallback
  // inside useAgentChat), so this genuinely only runs once.
  useEffect(() => {
    const state = useChatHistory.getState();
    const thread = state.activeThreadId
      ? state.threads.find((t) => t.id === state.activeThreadId)
      : undefined;
    if (thread) {
      skipNextSync.current = true;
      agent.loadThread(thread.messages);
    }
  }, [agent.loadThread]);

  // Persist once a turn settles. Deps are scoped to the agent hook's own
  // state only — never to `threads`/`activeThreadId` — so recordTurn's own
  // store update can never re-trigger this effect.
  const lastSynced = useRef<ChatMessage[] | null>(null);
  useEffect(() => {
    if (agent.streaming || agent.messages.length === 0) return;
    if (lastSynced.current === agent.messages) return;
    lastSynced.current = agent.messages;
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    useChatHistory.getState().recordTurn(agent.messages);
  }, [agent.streaming, agent.messages]);

  const newThread = useCallback(() => {
    agent.reset();
    useChatHistory.getState().startNewThread();
  }, [agent.reset]);

  const selectThread = useCallback(
    (id: string) => {
      const thread = useChatHistory.getState().threads.find((t) => t.id === id);
      if (!thread) return;
      skipNextSync.current = true;
      agent.loadThread(thread.messages);
      useChatHistory.getState().selectThread(id);
    },
    [agent.loadThread],
  );

  const deleteThread = useCallback(
    (id: string) => {
      const wasActive = useChatHistory.getState().activeThreadId === id;
      useChatHistory.getState().deleteThread(id);
      if (wasActive) agent.reset();
    },
    [agent.reset],
  );

  return { ...agent, threads, activeThreadId, newThread, selectThread, deleteThread };
}
