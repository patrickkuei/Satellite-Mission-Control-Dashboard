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
import path from 'node:path';
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
import { createCelestrakClient } from './clients/celestrak.client.js';
import { createNoaaSwpcClient } from './clients/noaa-swpc.client.js';
import { createTLERepository } from './repositories/tle.repository.js';
import { createWeatherRepository } from './repositories/weather.repository.js';
import { createOrbitService } from './services/orbit.service.js';
import { createSatelliteService } from './services/satellite.service.js';
import { createWeatherService } from './services/weather.service.js';
import { createTelemetryService } from './services/telemetry.service.js';
import { createAnomalyService } from './services/anomaly.service.js';
import { createAnomalyLogService } from './services/anomaly-log.service.js';
import { createAgentToolRegistry } from './services/agent-tools.service.js';
import { createToolBroker } from './services/tool-broker.js';
import { createAgentService } from './services/agent.service.js';
import { createGeminiProvider } from './clients/gemini.client.js';
import { createGroqProvider } from './clients/groq.client.js';
import { createAnthropicProvider } from './clients/anthropic.client.js';
import type { LLMProvider } from './clients/llm-provider.js';
import { createSatelliteController } from './controllers/satellite.controller.js';
import { createWeatherController } from './controllers/weather.controller.js';
import { createAnomalyController } from './controllers/anomaly.controller.js';
import { satelliteRoute } from './routes/satellite.route.js';
import { weatherRoute } from './routes/weather.route.js';
import { telemetryRoute } from './routes/telemetry.route.js';
import { anomalyRoute } from './routes/anomaly.route.js';
import { agentRoute } from './routes/agent.route.js';

/** Version reported by `/health`. Bumped in lockstep with `package.json`. */
const API_VERSION = '0.1.0';
const SERVICE_NAME = 'orbit-ctrl-api';
/** Default cache location, overridable via `TLE_CACHE_PATH`. */
const DEFAULT_TLE_CACHE_PATH = path.resolve(process.cwd(), 'data', 'tle-cache.json');

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
  await server.register(cors, { origin: '*', methods: ['GET', 'POST', 'OPTIONS'] });
  await server.register(websocket);

  // ── Dependency graph ─────────────────────────────────────────────────────
  const healthRepository = createHealthRepository();
  const healthService = createHealthService({
    repository: healthRepository,
    serviceName: SERVICE_NAME,
    version: API_VERSION,
  });
  const healthController = createHealthController(healthService);

  const celestrakClient = createCelestrakClient();
  const tleRepository = createTLERepository({
    cachePath: process.env.TLE_CACHE_PATH ?? DEFAULT_TLE_CACHE_PATH,
  });
  const orbitService = createOrbitService();
  const satelliteService = createSatelliteService({
    celestrak: celestrakClient,
    repository: tleRepository,
    orbit: orbitService,
    logger: {
      info: (msg) => server.log.info(msg),
      warn: (msg) => server.log.warn(msg),
    },
  });
  const satelliteController = createSatelliteController(satelliteService);

  const noaaClient = createNoaaSwpcClient();
  const weatherRepository = createWeatherRepository();
  const weatherService = createWeatherService({
    noaa: noaaClient,
    repository: weatherRepository,
    logger: {
      info: (msg) => server.log.info(msg),
      warn: (msg) => server.log.warn(msg),
    },
  });
  const weatherController = createWeatherController(weatherService);

  const telemetryService = createTelemetryService({
    listSatellites: () => satelliteService.list(),
    orbit: orbitService,
  });
  const anomalyService = createAnomalyService();
  const anomalyLogService = createAnomalyLogService();
  const anomalyController = createAnomalyController({
    anomalyLog: anomalyLogService,
    satellite: satelliteService,
  });

  // ── Agent layer ──────────────────────────────────────────────────────────
  // Builds a provider chain: Gemini → Groq → Anthropic. Each is optional —
  // providers without a configured API key are silently skipped. If no key is
  // configured at all, the route returns 503 so the rest of the dashboard runs.
  const llmChain = buildLLMChain(server.log);
  if (llmChain.length > 0) {
    const agentTools = createAgentToolRegistry({
      satellite: satelliteService,
      weather: weatherService,
      telemetry: telemetryService,
      orbit: orbitService,
      anomalyLog: anomalyLogService,
    });
    const toolBroker = createToolBroker(agentTools);
    const agentService = createAgentService({
      llm: llmChain,
      broker: toolBroker,
      tools: agentTools,
    });
    const chainNames = llmChain.map((p) => p.name).join(' → ');
    server.log.info(`agent: provider chain [${chainNames}] (${agentTools.length} tools)`);
    await server.register(agentRoute, { agent: agentService });
  } else {
    server.log.warn('agent: no LLM API key configured; /agent/chat will return 503');
    server.post('/agent/chat', async (_req, reply) => {
      reply.code(503).send({
        error: 'Agent unavailable',
        message: 'Set at least one of GEMINI_API_KEY, GROQ_API_KEY, or ANTHROPIC_API_KEY.',
      });
    });
  }

  // Pre-warm the TLE cache before accepting traffic so the first client request
  // is served from memory, not blocked on a Celestrak round-trip. Especially
  // important on Render free tier where the process restarts after idle.
  server.addHook('onReady', async () => {
    await satelliteService
      .list()
      .catch((err: Error) => server.log.warn(`TLE prefetch failed: ${err.message}`));
  });

  // ── Routes ───────────────────────────────────────────────────────────────
  await server.register(healthRoute, { controller: healthController });
  await server.register(satelliteRoute, { controller: satelliteController });
  await server.register(weatherRoute, { controller: weatherController });
  await server.register(telemetryRoute, {
    telemetry: telemetryService,
    anomaly: anomalyService,
    anomalyLog: anomalyLogService,
  });
  await server.register(anomalyRoute, { controller: anomalyController });

  return server;
}

/**
 * Build the ordered LLM provider fallback chain from environment variables.
 *
 * Chain order: Gemini (primary) → Groq (fast free-tier fallback) → Anthropic (quality backstop).
 * Each provider is included only if its API key is set — missing keys are
 * skipped with a warning rather than failing startup. An empty array means
 * no agent functionality is available.
 *
 * @example
 * ```
 * # All three configured → full chain
 * GEMINI_API_KEY=...  GROQ_API_KEY=...  ANTHROPIC_API_KEY=...
 * # Gemini only → no fallback, but still works
 * GEMINI_API_KEY=...
 * ```
 */
function buildLLMChain(log: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}): LLMProvider[] {
  const chain: LLMProvider[] = [];

  if (process.env.GEMINI_API_KEY) {
    chain.push(
      createGeminiProvider({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL,
      }),
    );
  } else {
    log.warn('GEMINI_API_KEY unset — Gemini excluded from provider chain');
  }

  if (process.env.GROQ_API_KEY) {
    chain.push(
      createGroqProvider({
        apiKey: process.env.GROQ_API_KEY,
        model: process.env.GROQ_MODEL,
      }),
    );
  } else {
    log.warn('GROQ_API_KEY unset — Groq excluded from provider chain');
  }

  if (process.env.ANTHROPIC_API_KEY) {
    chain.push(
      createAnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL,
      }),
    );
  } else {
    log.warn('ANTHROPIC_API_KEY unset — Anthropic excluded from provider chain');
  }

  return chain;
}
