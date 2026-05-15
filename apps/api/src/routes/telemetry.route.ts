/**
 * Telemetry WebSocket route — `/ws/telemetry`.
 *
 * Emits 1 Hz `{type:'telemetry'}` frames carrying one sample per tracked
 * satellite and `{type:'alert'}` frames whenever the anomaly engine surfaces
 * a new detection. Both envelopes match `WSMessageSchema` from
 * `@orbit-ctrl/types`, so the client parses with the same schema it uses
 * for compile-time types.
 *
 * The tick is shared across every connected client — one timer, broadcast
 * fan-out — so adding tabs doesn't multiply simulation cost or fragment
 * anomaly-engine state. The timer starts on the first connection and stops
 * after the last disconnect.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Anomaly, Telemetry, WSMessage } from '@orbit-ctrl/types';

/** Minimal structural type covering the methods we call on a WS connection. */
interface BroadcastSocket {
  send(data: string): void;
  on(event: 'close', listener: () => void): void;
}
import type { TelemetryService } from '../services/telemetry.service.js';
import type { AnomalyService } from '../services/anomaly.service.js';
import type { AnomalyLogService } from '../services/anomaly-log.service.js';

/** Sample cadence in milliseconds. */
const TICK_MS = 1000;

export interface TelemetryRouteOptions {
  telemetry: TelemetryService;
  anomaly: AnomalyService;
  /** Optional historical log; if provided, every emitted anomaly is appended for the agent's `get_anomalies` tool. */
  anomalyLog?: AnomalyLogService;
}

/**
 * Register the `/ws/telemetry` WebSocket endpoint.
 *
 * @example
 * ```ts
 * await server.register(telemetryRoute, { telemetry, anomaly });
 * ```
 */
export const telemetryRoute: FastifyPluginAsync<TelemetryRouteOptions> = async (
  fastify: FastifyInstance,
  opts: TelemetryRouteOptions,
) => {
  const clients = new Set<BroadcastSocket>();
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    let samples: Telemetry[];
    try {
      samples = await opts.telemetry.sample();
    } catch (err) {
      fastify.log.warn(`telemetry sample failed: ${(err as Error).message}`);
      return;
    }
    broadcast(clients, { type: 'telemetry', data: samples });

    const newAlerts: Anomaly[] = [];
    for (const sample of samples) newAlerts.push(...opts.anomaly.evaluate(sample));
    for (const alert of newAlerts) {
      opts.anomalyLog?.append(alert);
      broadcast(clients, { type: 'alert', data: alert });
    }
  }

  function ensureTimer(): void {
    if (timer || clients.size === 0) return;
    timer = setInterval(() => {
      void tick();
    }, TICK_MS);
  }

  function maybeStopTimer(): void {
    if (timer && clients.size === 0) {
      clearInterval(timer);
      timer = null;
    }
  }

  fastify.get('/ws/telemetry', { websocket: true }, (socket) => {
    clients.add(socket);
    ensureTimer();
    fastify.log.info(`ws/telemetry: client connected (total=${clients.size})`);

    socket.on('close', () => {
      clients.delete(socket);
      maybeStopTimer();
      fastify.log.info(`ws/telemetry: client disconnected (total=${clients.size})`);
    });
  });

  fastify.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    timer = null;
    clients.clear();
  });
};

/** Send `msg` to every client, dropping ones that error out mid-send. */
function broadcast(clients: Set<BroadcastSocket>, msg: WSMessage): void {
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    try {
      client.send(payload);
    } catch {
      clients.delete(client);
    }
  }
}
