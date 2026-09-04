import { useChatHistory, type ChatThread } from './chatHistory.js';
import type { ChatMessage } from '../hooks/useAgentChat.js';

// `localStorage` itself is polyfilled globally in jest.setup.cjs (persist
// accesses it synchronously at module-eval time, before any beforeEach could
// run) — this suite only needs to clear it between tests, along with the
// store's in-memory state. Assertions below are against the store's
// in-memory state, not localStorage's contents.

const INITIAL_STATE = { threads: [] as ChatThread[], activeThreadId: null as string | null };

function makeMessages(...userTexts: string[]): ChatMessage[] {
  return userTexts.map((content, i) => ({
    id: `u-${i}`,
    role: 'user' as const,
    content,
    toolCalls: [],
  }));
}

beforeEach(() => {
  localStorage.clear();
  // No `replace` flag: a replace-mode setState would wipe the store's action
  // functions too, since they live on the same state object as the data.
  useChatHistory.setState(INITIAL_STATE);
});

describe('useChatHistory — recordTurn', () => {
  it('creates a new thread on the first call, deriving the title from the first user message', () => {
    useChatHistory.getState().recordTurn(makeMessages('What is overhead right now?'));

    const { threads, activeThreadId } = useChatHistory.getState();
    expect(threads).toHaveLength(1);
    expect(threads[0]?.title).toBe('What is overhead right now?');
    expect(activeThreadId).toBe(threads[0]?.id);
  });

  it('truncates long first messages to the title length limit with an ellipsis', () => {
    const long = 'a'.repeat(60);
    useChatHistory.getState().recordTurn(makeMessages(long));

    const title = useChatHistory.getState().threads[0]?.title;
    expect(title).toBe(`${'a'.repeat(40)}…`);
  });

  it('upserts the active thread on subsequent calls without changing its title', () => {
    const firstQuestion = 'First question';
    useChatHistory.getState().recordTurn(makeMessages(firstQuestion));
    const firstId = useChatHistory.getState().activeThreadId;
    const firstUpdatedAt = useChatHistory.getState().threads[0]?.updatedAt;

    const grown = [...makeMessages(firstQuestion), ...makeMessages('Follow-up question')];
    useChatHistory.getState().recordTurn(grown);

    const { threads, activeThreadId } = useChatHistory.getState();
    expect(threads).toHaveLength(1);
    expect(activeThreadId).toBe(firstId);
    const updated = threads[0] as ChatThread;
    expect(updated.title).toBe(firstQuestion);
    expect(updated.messages).toHaveLength(2);
    expect(updated.updatedAt >= (firstUpdatedAt as string)).toBe(true);
  });

  it('self-heals when activeThreadId points at a thread that no longer exists', () => {
    useChatHistory.setState({ threads: [], activeThreadId: 'ghost-id' });

    useChatHistory.getState().recordTurn(makeMessages('New after a stale pointer'));

    const { threads, activeThreadId } = useChatHistory.getState();
    expect(threads).toHaveLength(1);
    expect(activeThreadId).toBe(threads[0]?.id);
    expect(activeThreadId).not.toBe('ghost-id');
  });

  it('evicts the globally oldest thread once over the cap', () => {
    // Seed 30 threads with strictly increasing updatedAt, oldest first.
    const seeded: ChatThread[] = Array.from({ length: 30 }, (_, i) => ({
      id: `t${i}`,
      title: `Thread ${i}`,
      messages: makeMessages(`msg ${i}`),
      createdAt: new Date(i).toISOString(),
      updatedAt: new Date(i).toISOString(),
    }));
    useChatHistory.setState({ threads: seeded, activeThreadId: null });

    useChatHistory.getState().recordTurn(makeMessages('One over the cap'));

    const { threads, activeThreadId } = useChatHistory.getState();
    expect(threads).toHaveLength(30);
    expect(threads.some((t) => t.id === 't0')).toBe(false);
    expect(threads.some((t) => t.id === 't1')).toBe(true);
    // The just-created thread is newest by construction, so it's never the
    // one evicted even without special-casing it against the eviction pool.
    expect(threads.some((t) => t.id === activeThreadId)).toBe(true);
  });
});

describe('useChatHistory — deleteThread', () => {
  it('clears activeThreadId when the deleted thread was active', () => {
    useChatHistory.getState().recordTurn(makeMessages('To be deleted'));
    const id = useChatHistory.getState().activeThreadId as string;

    useChatHistory.getState().deleteThread(id);

    const { threads, activeThreadId } = useChatHistory.getState();
    expect(threads).toHaveLength(0);
    expect(activeThreadId).toBeNull();
  });

  it('leaves activeThreadId untouched when deleting a non-active thread', () => {
    useChatHistory.getState().recordTurn(makeMessages('Active thread'));
    const activeId = useChatHistory.getState().activeThreadId as string;
    useChatHistory.setState({ activeThreadId: null });
    useChatHistory.getState().recordTurn(makeMessages('Other thread'));
    const otherId = useChatHistory.getState().activeThreadId as string;

    useChatHistory.getState().deleteThread(activeId);

    expect(useChatHistory.getState().activeThreadId).toBe(otherId);
    expect(useChatHistory.getState().threads).toHaveLength(1);
  });
});
