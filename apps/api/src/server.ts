/**
 * Composition root.
 *
 * Wires plugins (CORS, WebSocket), instantiates the dependency graph
 * (repository → service → controller), and registers route modules. This is
 * the only file allowed to know about every layer at once.
 *
 * Keep this file declarative: build instances at the top, register routes at
 * the bottom. Never put business logic here.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { createHealthRepository } from './repositories/health.repository.js';
import { createHealthService } from './services/health.service.js';
import { createHealthController } from './controllers/health.controller.js';
import { healthRoute } from './routes/health.route.js';

/** Version reported by `/health`. Bumped in lockstep with `package.json`. */
const API_VERSION = '0.1.0';
const SERVICE_NAME = 'orbit-ctrl-api';

/**
 * Build a configured Fastify instance with all plugins, dependencies, and
 * routes registered. Does not call `.listen()` — caller decides when (and
 * whether) to bind a port. Tests use `server.inject(...)` instead.
 *
 * @example
 * ```ts
 * const server = await buildServer();
 * const res = await server.inject({ method: 'GET', url: '/health' });
 * expect(res.statusCode).toBe(200);
 * ```
 */
export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV === 'production'
          ? undefined
          : {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'HH:MM:ss.l' },
            },
    },
  }).withTypeProvider<ZodTypeProvider>();

  // ── Zod as schema source of truth ────────────────────────────────────────
  // Routes register Zod schemas; these compilers drive request validation +
  // response serialization. All shared schemas live in `@orbit-ctrl/types`.
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  // ── Plugins ──────────────────────────────────────────────────────────────
  await server.register(cors, { origin: true });
  await server.register(websocket);

  // ── Dependency graph ─────────────────────────────────────────────────────
  const healthRepository = createHealthRepository();
  const healthService = createHealthService({
    repository: healthRepository,
    serviceName: SERVICE_NAME,
    version: API_VERSION,
  });
  const healthController = createHealthController(healthService);

  // ── Routes ───────────────────────────────────────────────────────────────
  await server.register(healthRoute, { controller: healthController });

  // ── Phase 0 WebSocket smoke test ────────────────────────────────────────
  // Replaced in Phase 3 by `/ws/telemetry` and `/ws/alerts` route modules.
  server.get('/ws/ping', { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: 'hello', message: 'orbit-ctrl ws online' }));
    socket.on('message', (raw: Buffer) => {
      socket.send(JSON.stringify({ type: 'echo', message: raw.toString() }));
    });
  });

  return server;
}
