/**
 * Transport-level retry with exponential backoff + jitter.
 *
 * Used by every LLM adapter to absorb transient upstream failures (429
 * rate-limit, 5xx, dropped sockets) without surfacing them to the agent
 * orchestrator. Non-transient errors (4xx other than 429, malformed
 * responses, invalid API keys) fall through immediately — retrying them
 * just wastes the rate budget.
 *
 * The classification is intentionally coarse-grained: anything that looks
 * like "the server is overloaded or unreachable" is transient; anything
 * else is fatal for this request.
 */

const DEFAULT_MAX_ATTEMPTS = 3;
/** Base delay in ms — doubled each attempt, capped at MAX_DELAY_MS. */
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;
/** Random jitter added to each delay to avoid synchronized retries. */
const JITTER_MS = 250;

/**
 * Run `fn`, retrying on transient errors with exponential backoff + jitter.
 *
 * @param fn   - Async operation to attempt. Re-invoked on each retry.
 * @param max  - Maximum attempts (including the first). Default 3.
 * @returns The resolved value of `fn` on the first successful attempt.
 * @throws The last error if every attempt fails, or the original error
 *         immediately if it isn't transient.
 *
 * @example
 * ```ts
 * const resp = await withBackoff(() => fetch(url), 3);
 * ```
 */
export async function withBackoff<T>(fn: () => Promise<T>, max = DEFAULT_MAX_ATTEMPTS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === max - 1) throw err;
      const delay =
        Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS) + Math.random() * JITTER_MS;
      await sleep(delay);
    }
  }
  // Unreachable: the loop either returns or throws.
  throw lastError;
}

/**
 * Classify an error as transient (retry-worthy) vs fatal. The heuristics are:
 *   - HTTP-style errors with a `status` field: 429 and 5xx are transient.
 *   - Errors with `code` matching common network failures (`ETIMEDOUT`,
 *     `ECONNRESET`, `ENOTFOUND`, etc.) are transient.
 *   - Anything else (auth, malformed schema, validation) is fatal.
 */
function isTransient(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; statusCode?: number; code?: string };
  const status = e.status ?? e.statusCode;
  return (
    status === 429 ||
    (status !== undefined && status >= 500 && status < 600) ||
    (typeof e.code === 'string' && TRANSIENT_CODES.has(e.code))
  );
}

const TRANSIENT_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
