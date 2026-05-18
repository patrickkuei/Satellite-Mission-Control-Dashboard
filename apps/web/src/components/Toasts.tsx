/**
 * Toasts — fixed-position overlay that renders transient error notifications.
 *
 * Reads from {@link useToastStore}. Rendered once at the App root so it sits
 * above all other content without z-index battles.
 */
import { useToastStore } from '../stores/toasts';
import styles from './Toasts.module.css';

/**
 * Mount once at the App root. No props — all state lives in the toast store.
 *
 * @example
 * ```tsx
 * <Toasts />  // anywhere in the tree, typically at the end of App
 * ```
 */
export function Toasts(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.removeToast);

  return (
    <div className={styles.container} aria-live="assertive" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast}>
          <span className={styles.message}>{t.message}</span>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => remove(t.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
