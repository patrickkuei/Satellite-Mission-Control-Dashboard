/**
 * Root component — layout composition only.
 *
 * Demonstrates the conventions all future code follows:
 * - Stateful logic comes from a hook (`useApiHealth`)
 * - Presentational pieces live in `components/` (`StatusBadge`)
 * - This file just wires them together
 */
import StatusBadge from './components/StatusBadge';
import { useApiHealth } from './hooks/useApiHealth';
import styles from './App.module.css';

export function App(): JSX.Element {
  const { data, error } = useApiHealth();
  const status = error ? 'offline' : (data?.status ?? null);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>orbit.ctrl</span>
        <StatusBadge status={status} />
      </header>
      <section className={styles.hero}>
        <h1 className={styles.heading}>Phase 0 — scaffolding online</h1>
        <p className={styles.body}>
          Frontend, backend, and shared packages are wired. Phase 1 brings the 3D globe.
        </p>
        <p className={styles.data}>
          {data
            ? `api v${data.version} · uptime ${Math.round(data.process.uptimeSeconds)}s · rss ${data.process.memoryRssMb} MB`
            : '— · — · —'}
        </p>
      </section>
    </main>
  );
}
