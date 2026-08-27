import type { FastifyPluginAsync } from "fastify";
import type { RequestUser } from "../plugins/auth.js";

// Simple SSE event store (in-memory for P1)
const subscribers = new Map<string, Set<(data: string) => void>>();

export function publishEvent(interviewId: string, event: string, data: any) {
  const subs = subscribers.get(interviewId);
  if (!subs) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const send of subs) {
    try { send(payload); } catch { subs.delete(send); }
  }
}

export const sseRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>("/interviews/:id/events", async (req, reply) => {
    // authPlugin has already verified the same-origin HttpOnly session cookie
    // and performed resource-level interview authorization.
    if (!(req.user as RequestUser | undefined)) {
      return reply.status(401).send({
        code: "UNAUTHORIZED",
        message: "Valid session required",
      });
    }

    const interviewId = req.params.id;

    // Use reply.hijack() to take over the raw response — required for SSE streaming.
    // Without hijack, Fastify won't resolve the handler and app.inject() hangs forever.
    reply.hijack();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });

    const send = (data: string) => {
      try { reply.raw.write(data); } catch { /* client disconnected */ }
    };

    // Register subscriber
    if (!subscribers.has(interviewId)) {
      subscribers.set(interviewId, new Set());
    }
    subscribers.get(interviewId)!.add(send);

    // Send initial connection event
    send(`event: connected\ndata: {"interviewId":"${interviewId}"}\n\n`);

    // Heartbeat
    const heartbeat = setInterval(() => {
      send(`: heartbeat ${Date.now()}\n\n`);
    }, 15000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      const subs = subscribers.get(interviewId);
      if (subs) {
        subs.delete(send);
        if (subs.size === 0) subscribers.delete(interviewId);
      }
    });
  });
};
