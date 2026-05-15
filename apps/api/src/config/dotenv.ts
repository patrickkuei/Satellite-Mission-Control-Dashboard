/**
 * Minimal `.env` loader — populates `process.env` from a file on disk.
 *
 * Tiny by design: `KEY=value` lines, `#` comments, optional surrounding
 * quotes, no interpolation, no expansion, no multi-line. The agent layer
 * needs exactly one secret (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) at
 * dev time; production deployments inject env vars through the platform
 * (Fly.io secrets, Docker env), not a checked-in file.
 *
 * Pulling in `dotenv` would work but adds a runtime dep for ~20 lines of
 * parsing. Node 22 has `--env-file-if-exists` but tsx-watch doesn't yet
 * forward it reliably across all platforms — this stays portable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Stop the upward walk once we've climbed this many directories. */
const MAX_PARENT_HOPS = 6;

/**
 * Load the nearest `.env` into `process.env`. Walks upward from the start
 * directory until it finds one (so running from `apps/api` or the repo
 * root both pick up the workspace-root `.env`). Silently no-ops if no
 * `.env` exists — production paths set their env out-of-band. Already-set
 * variables win (the file never overrides a platform-provided secret).
 *
 * @param start - Directory to begin the search from. Defaults to `process.cwd()`.
 *
 * @example
 * ```ts
 * import { loadDotenv } from './config/dotenv.js';
 * loadDotenv();
 * const key = process.env.GEMINI_API_KEY;
 * ```
 */
export function loadDotenv(start: string = process.cwd()): void {
  const envPath = findDotenv(start);
  if (!envPath) return;
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed && process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

/**
 * Walk from `start` toward the filesystem root looking for `.env`. Returns
 * the absolute path of the first match, or `null` if none is found within
 * {@link MAX_PARENT_HOPS} levels.
 */
function findDotenv(start: string): string | null {
  let dir = resolve(start);
  for (let hop = 0; hop < MAX_PARENT_HOPS; hop++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Parse one `.env` line. Returns `null` for blank lines, comments, and
 * malformed entries; otherwise the trimmed key/value pair with any
 * surrounding single or double quotes stripped from the value.
 */
function parseLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  if (eq === -1) return null;
  const key = trimmed.slice(0, eq).trim();
  if (!key) return null;
  const value = trimmed
    .slice(eq + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
  return { key, value };
}
