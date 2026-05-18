/**
 * GlobeSkeleton — placeholder shown while the Globe component lazy-loads.
 *
 * Matches the Globe's flex-1 sizing so the layout doesn't shift once Three.js
 * initialises. The pulsing ring gives a sense of activity without implying
 * content is ready.
 */
import styles from './GlobeSkeleton.module.css';

/** Drop-in Suspense fallback for the Globe. No props needed. */
export function GlobeSkeleton(): JSX.Element {
  return (
    <div className={styles.host} aria-label="Loading globe…">
      <div className={styles.ring} />
    </div>
  );
}
