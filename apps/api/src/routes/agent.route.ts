/**
 * Agent route — `POST /agent/chat`.
 *
 * Streams the agent's response as Server-Sent Events. SSE (rather than
 * WebSocket) because the conversation is request/response in shape — one
 * user message in, one streamed assistant turn out — and SSE composes
 * naturally with `fetch` + `ReadableStream` on the browser side.
 *
 * Each line is a typed envelope from {@link AgentEvent}, JSON-encoded.
 * The client multiplexes them: text deltas append to the message,
 * `tool_start`/`tool_end` render a "→ Calling X…" chip, and `done`
 * signals stream completion.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AgentService } from '../services/agent.service.js';

/** Body schema — Zod-validated by the type provider. */
const AgentChatBodySchema = z.object({
  message: z.string().min(1).max(2000),
});

export interface AgentRouteOptions {
  agent: AgentService;
}

/**
 * Register the `/agent/chat` SSE endpoint.
 *
 * @example
 * ```ts
 * await server.register(agentRoute, { agent: agentService });
 * ```
 */
export const agentRoute: FastifyPluginAsync<AgentRouteOptions> = async (
  fastify: FastifyInstance,
  opts: AgentRouteOptions,
) => {
  fastify.post('/agent/chat', { schema: { body: AgentChatBodySchema } }, async (request, reply) => {
    const { message } = request.body as z.infer<typeof AgentChatBodySchema>;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const evt of opts.agent.chat(message)) {
        reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
        if (evt.type === 'done') break;
      }
    } catch (err) {
      fastify.log.error({ err }, 'agent stream failed');
      const payload = { type: 'error', message: (err as Error).message };
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
};
