import Fastify from "fastify";
import cors from "@fastify/cors";
import authPlugin from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { interviewRoutes } from "./routes/interviews.js";
import { transcriptRoutes } from "./routes/transcripts.js";
import { reviewRoutes } from "./routes/reviews.js";
import { planRoutes } from "./routes/plans.js";
import { sseRoutes } from "./routes/sse.js";
import { feishuRoutes } from "./routes/feishu.js";
import { oauthRoutes } from "./routes/oauth.js";
import { prisma } from "./db.js";

// Load .env (development only; production uses environment variables)
try { process.loadEnvFile?.(); } catch { /* no .env file in production */ }

const server = Fastify({ logger: true });

// CORS: restrict to localhost in dev, explicit origins in production
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
  : ["http://localhost:5173", "http://127.0.0.1:5173"];

await server.register(cors, {
  origin: corsOrigin,
  credentials: true,
});

// ─── Auth (must register before routes for onRequest hook order) ───
await server.register(authPlugin);

// ─── Routes ───
await server.register(authRoutes, { prefix: "/api/v1" });
await server.register(interviewRoutes, { prefix: "/api/v1" });
await server.register(planRoutes, { prefix: "/api/v1" });
await server.register(transcriptRoutes, { prefix: "/api/v1" });
await server.register(reviewRoutes, { prefix: "/api/v1" });
await server.register(sseRoutes, { prefix: "/api/v1" });
await server.register(feishuRoutes, { prefix: "/api/v1" });
await server.register(oauthRoutes, { prefix: "/api/v1" });

// Health check
server.get("/api/v1/health", async () => ({ status: "ok", time: new Date().toISOString() }));
server.get("/api/v1/health/live", async () => ({ status: "live" }));
server.get("/api/v1/health/ready", async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ready" };
  } catch {
    return reply.code(503).send({ status: "not_ready" });
  }
});

// Start
try {
  const port = parseInt(process.env.PORT || "3001", 10);
  const host = process.env.HOST || "0.0.0.0";
  await server.listen({ port, host });
  console.log(`🚀 Vice Interviewer API running on http://localhost:${port}`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

export default server;
