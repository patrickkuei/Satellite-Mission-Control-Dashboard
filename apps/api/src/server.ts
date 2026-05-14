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
import { createSatelliteController } from './controllers/satellite.controller.js';
import { createWeatherController } from './controllers/weather.controller.js';
import { satelliteRoute } from './routes/satellite.route.js';
import { weatherRoute } from './routes/weather.route.js';
import { telemetryRoute } from './routes/telemetry.route.js';

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

  // ── Routes ───────────────────────────────────────────────────────────────
  await server.register(healthRoute, { controller: healthController });
  await server.register(satelliteRoute, { controller: satelliteController });
  await server.register(weatherRoute, { controller: weatherController });
  await server.register(telemetryRoute, {
    telemetry: telemetryService,
    anomaly: anomalyService,
  });

  return server;
}
