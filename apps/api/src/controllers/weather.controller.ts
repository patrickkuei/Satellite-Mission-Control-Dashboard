/**
 * Weather controller — HTTP adapter for the {@link WeatherService}.
 *
 * One endpoint, one method: GET /space-weather → current snapshot. Errors
 * surface as 503 (Service Unavailable) because they indicate the upstream
 * data provider, not a client mistake.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SpaceWeather } from '@orbit-ctrl/types';
import type { WeatherService } from '../services/weather.service.js';

/** Public surface of the weather controller. */
export interface WeatherController {
  /** Handle `GET /space-weather`. */
  getCurrent(req: FastifyRequest, reply: FastifyReply): Promise<SpaceWeather>;
}

/**
 * Build a controller bound to a service instance.
 *
 * @example
 * ```ts
 * const controller = createWeatherController(weatherService);
 * fastify.get('/space-weather', controller.getCurrent);
 * ```
 */
export function createWeatherController(service: WeatherService): WeatherController {
  return {
    async getCurrent(_req, reply) {
      try {
        reply.type('application/json');
        return await service.getCurrent();
      } catch (err) {
        reply.code(503);
        throw err;
      }
    },
  };
}
