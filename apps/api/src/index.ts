/**
 * orbit.ctrl API gateway — entry point.
 *
 * Starts the Fastify server on `PORT` (default 3001) with WebSocket and CORS
 * plugins registered. Phase 0 ships only:
 * - `GET  /health`  liveness probe
 * - `GET  /ws/ping` echo WebSocket for connectivity smoke-tests
 *
 * Real routes (`/satellites`, `/space-weather`, `/agent/chat`,
 * `/ws/telemetry`, `/ws/alerts`) are added in Phase 1+.
 *
 * @example
 * ```powershell
 * # From repo root
 * pnpm --filter @orbit-ctrl/api dev
 * # Then in another terminal:
 * curl http://localhost:3001/health
 * # → { "status": "ok", "service": "orbit-ctrl-api", "version": "0.1.0" }
 * ```
 */
import { buildServer } from './server.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const server = await buildServer();

  try {
    const address = await server.listen({ port: PORT, host: HOST });
    server.log.info(`orbit.ctrl API listening at ${address}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
