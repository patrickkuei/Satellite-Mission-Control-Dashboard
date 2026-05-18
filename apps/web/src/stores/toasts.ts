/**
 * toasts — lightweight Zustand slice for transient error notifications.
 *
 * Designed to be called from outside React (e.g., QueryCache.onError in
 * main.tsx), so it uses the store's imperative `getState().addToast()` API
 * rather than a hook.
 */
import { create } from 'zustand';

export interface Toast {
  /** Unique key — used as React list key and for dedup. */
  id: string;
  /** Human-readable message shown in the toast. */
  message: string;
  /** Visual severity. Only 'error' exists for now; extend if needed. */
  kind: 'error';
}

interface ToastStore {
  toasts: Toast[];
  /** Push a new toast. Auto-dismissed after {@link TOAST_DURATION_MS}. */
  addToast(message: string): void;
  /** Remove a specific toast by id. */
  removeToast(id: string): void;
}

/** How long a toast stays visible before auto-dismissal (ms). */
const TOAST_DURATION_MS = 5000;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast(message) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind: 'error' }] }));
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, TOAST_DURATION_MS);
  },

  removeToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
