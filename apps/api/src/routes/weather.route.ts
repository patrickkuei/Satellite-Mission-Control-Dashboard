/**
 * Weather route — Fastify plugin binding `GET /space-weather` to the weather
 * controller. Pure URL → handler wiring with the shared
 * {@link SpaceWeatherSchema} driving response serialization.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SpaceWeatherSchema } from '@orbit-ctrl/types';
import type { WeatherController } from '../controllers/weather.controller.js';

export interface WeatherRouteOptions {
  controller: WeatherController;
}

/**
 * Register the `/space-weather` route on the given Fastify instance.
 *
 * @example
 * ```ts
 * await server.register(weatherRoute, { controller: weatherController });
 * ```
 */
export const weatherRoute: FastifyPluginAsync<WeatherRouteOptions> = async (
  fastify: FastifyInstance,
  opts: WeatherRouteOptions,
) => {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/space-weather',
    {
      schema: {
        response: {
          200: SpaceWeatherSchema,
        },
      },
    },
    opts.controller.getCurrent,
  );
};
