/**
 * Anomaly controller — HTTP adapter for the {@link AnomalyLogService}.
 *
 * Exposes recent anomaly detections as a REST endpoint so external consumers
 * (the MCP server) can query the log without a WebSocket connection.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Anomaly } from '@orbit-ctrl/types';
import type { AnomalyLogService } from '../services/anomaly-log.service.js';
import type { SatelliteService } from '../services/satellite.service.js';

/** Construction-time dependencies for the anomaly controller. */
export interface AnomalyControllerDeps {
  anomalyLog: AnomalyLogService;
  /** Used to resolve an optional satellite `name` query param to a NORAD ID. */
  satellite: SatelliteService;
}

/** Public surface of the anomaly controller. */
export interface AnomalyController {
  getRecent(
    req: FastifyRequest<{ Querystring: { name?: string; sinceMinutes?: number } }>,
    reply: FastifyReply,
  ): Promise<Anomaly[]>;
}

/**
 * Build a controller bound to the anomaly log and satellite service.
 *
 * @example
 * ```ts
 * const ctrl = createAnomalyController({ anomalyLog, satellite: satelliteService });
 * await server.register(anomalyRoute, { controller: ctrl });
 * ```
 */
export function createAnomalyController(deps: AnomalyControllerDeps): AnomalyController {
  return {
    async getRecent(req, reply) {
      reply.type('application/json');
      const { name, sinceMinutes } = req.query;

      let satelliteId: number | undefined;
      if (name?.trim()) {
        const list = await deps.satellite.list();
        const numeric = Number(name);
        const found = Number.isInteger(numeric)
          ? list.find((s) => s.noradId === numeric)
          : list.find((s) => s.name.toLowerCase().includes(name.toLowerCase().trim()));
        if (!found) {
          reply.code(404);
          throw new Error(`Satellite "${name}" not found`);
        }
        satelliteId = found.noradId;
      }

      return deps.anomalyLog.recent({ satelliteId, sinceMinutes });
    },
  };
}
