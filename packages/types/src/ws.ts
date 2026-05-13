/**
 * WebSocket message envelopes emitted by the API gateway.
 *
 * The `type` discriminator tells the client how to interpret `data`. Keep this
 * union exhaustive — consumers `switch` on it.
 *
 * @packageDocumentation
 */
import { z } from 'zod';
import { PositionSchema } from './position.js';
import { TelemetrySchema } from './telemetry.js';
import { AnomalySchema } from './anomaly.js';

/**
 * Position update payload pushed to clients viewing the live globe. Pairs the
 * satellite's NORAD ID with its current `Position`.
 */
export const SatellitePositionUpdateSchema = z
  .object({
    satelliteId: z.number().int().positive(),
    position: PositionSchema,
  })
  .strict();

/** Inferred type for {@link SatellitePositionUpdateSchema}. */
export type SatellitePositionUpdate = z.infer<typeof SatellitePositionUpdateSchema>;

/**
 * Discriminated-union envelope for WebSocket messages emitted by the API.
 *
 * @example
 * ```ts
 * ws.onmessage = (event) => {
 *   const msg = WSMessageSchema.parse(JSON.parse(event.data));
 *   switch (msg.type) {
 *     case 'telemetry': handleTelemetry(msg.data); break;
 *     case 'alert':     handleAnomaly(msg.data);   break;
 *     case 'positions': handlePositions(msg.data); break;
 *   }
 * };
 * ```
 */
export const WSMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('telemetry'), data: z.array(TelemetrySchema) }).strict(),
  z.object({ type: z.literal('alert'), data: AnomalySchema }).strict(),
  z.object({ type: z.literal('positions'), data: z.array(SatellitePositionUpdateSchema) }).strict(),
]);

/** Inferred type for {@link WSMessageSchema}. */
export type WSMessage = z.infer<typeof WSMessageSchema>;
