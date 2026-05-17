/**
 * Satellite controller — HTTP adapter for the {@link SatelliteService}.
 *
 * Three endpoints feed the frontend's globe:
 *   - `GET /satellites`                       — curated list (one-time fetch)
 *   - `GET /satellites/positions`             — batched positions (1 Hz poll)
 *   - `GET /satellites/:id/position`          — single satellite (debug / agent)
 *   - `GET /satellites/:id/track`             — forward ground track for path rendering
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GroundTrack, Pass, Position, Satellite } from '@orbit-ctrl/types';
import {
  SatelliteNotFoundError,
  type SatelliteService,
  type VisibleSatellite,
} from '../services/satellite.service.js';

/** Default pass-prediction window (in hours) when the client doesn't specify. */
const DEFAULT_PASS_HOURS = 24;

/** Public surface of the satellite controller. */
export interface SatelliteController {
  list(req: FastifyRequest, reply: FastifyReply): Promise<Satellite[]>;
  listPositions(
    req: FastifyRequest<{ Querystring: { time?: string } }>,
    reply: FastifyReply,
  ): Promise<Position[]>;
  getPosition(
    req: FastifyRequest<{ Params: { id: number }; Querystring: { time?: string } }>,
    reply: FastifyReply,
  ): Promise<Position>;
  getGroundTrack(
    req: FastifyRequest<{ Params: { id: number }; Querystring: { periodMin?: number } }>,
    reply: FastifyReply,
  ): Promise<GroundTrack>;
  getPasses(
    req: FastifyRequest<{
      Params: { id: number };
      Querystring: { lat: number; lon: number; hours?: number; altMeters?: number };
    }>,
    reply: FastifyReply,
  ): Promise<Pass[]>;
  getAbove(
    req: FastifyRequest<{
      Querystring: { lat: number; lon: number; minElevationDeg?: number };
    }>,
    reply: FastifyReply,
  ): Promise<{
    totalVisible: number;
    showing: number;
    note?: string;
    satellites: VisibleSatellite[];
  }>;
}

/**
 * Build a controller bound to a service instance.
 *
 * The controller's only jobs are: parse params/query, call exactly one
 * service method, and map domain errors (`SatelliteNotFoundError`) to HTTP
 * status codes.
 */
export function createSatelliteController(service: SatelliteService): SatelliteController {
  const handleNotFound = async <T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T> => {
    try {
      reply.type('application/json');
      return await fn();
    } catch (err) {
      if (err instanceof SatelliteNotFoundError) {
        reply.code(404);
        throw err;
      }
      throw err;
    }
  };

  return {
    async list(_req, reply) {
      reply.type('application/json');
      return service.list();
    },
    async listPositions(req, reply) {
      reply.type('application/json');
      const time = req.query.time ? new Date(req.query.time) : new Date();
      return service.listPositions(time);
    },
    async getPosition(req, reply) {
      return handleNotFound(reply, () => {
        const time = req.query.time ? new Date(req.query.time) : new Date();
        return service.positionOf(req.params.id, time);
      });
    },
    async getGroundTrack(req, reply) {
      return handleNotFound(reply, () => service.groundTrack(req.params.id, req.query.periodMin));
    },
    async getPasses(req, reply) {
      return handleNotFound(reply, () =>
        service.passesOf(
          req.params.id,
          { lat: req.query.lat, lon: req.query.lon, altMeters: req.query.altMeters },
          req.query.hours ?? DEFAULT_PASS_HOURS,
        ),
      );
    },
    async getAbove(req, reply) {
      reply.type('application/json');
      const { lat, lon, minElevationDeg } = req.query;
      const satellites = await service.findAbove({ lat, lon }, minElevationDeg);
      const total = satellites.length;
      return { totalVisible: total, showing: total, satellites };
    },
  };
}
