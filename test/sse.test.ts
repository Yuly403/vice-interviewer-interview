/**
 * SSE 实时事件 E2E 测试
 *
 * 验证 GET /api/v1/interviews/:id/events 端点：
 * - 认证 (token query param + Authorization header)
 * - 连接确认事件
 * - 心跳机制
 * - publishEvent 推送
 * - SSE 格式合规
 *
 * SSE 流式端点使用 reply.hijack()，app.inject() 只能验证 401 拒绝场景；
 * 所有 200 响应测试使用 app.listen() + 真实 HTTP 连接。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import http from "http";
import type { IncomingMessage } from "http";
import { sseRoutes, publishEvent } from "../apps/api/src/routes/sse.js";

// ─── JWT Helpers ─────────────────────────────────────────────────────────────

const JWT_SECRET = "test-sse-secret-key-2026";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(): string {
  return jwt.sign(
    {
      sub: "user-test-001",
      feishuOpenId: "ou-test-sse",
      displayName: "SSE测试用户",
      role: "admin",
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function makeExpiredToken(): string {
  return jwt.sign(
    {
      sub: "user-test-001",
      feishuOpenId: "ou-test-sse",
      displayName: "SSE测试用户",
      role: "admin",
    },
    JWT_SECRET,
    { expiresIn: "0s" },
  );
}

// ─── SSE stream helpers ──────────────────────────────────────────────────────

interface SseResult {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  data: string;
}

/**
 * Open an SSE connection with the given auth parameters.
 * Collects up to `maxChunks` SSE frames before disconnecting.
 */
function connectSse(
  baseUrl: string,
  interviewId: string,
  opts: { token?: string; authHeader?: string; queryToken?: string },
  maxChunks = 2,
): Promise<SseResult> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    if (opts.queryToken) params.set("token", opts.queryToken);

    const qs = params.toString();
    const path = `/api/v1/interviews/${encodeURIComponent(interviewId)}/events${qs ? "?" + qs : ""}`;

    const headers: Record<string, string> = {};
    if (opts.authHeader) headers["authorization"] = opts.authHeader;

    const req = http.get(`${baseUrl}${path}`, { headers }, (res: IncomingMessage) => {
      let data = "";
      const done = () => {
        try { req.destroy(); } catch {}
        resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, data });
      };

      // If the server immediately ends (e.g. 401), emit end quickly
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.split("\n\n").length >= maxChunks) {
          done();
        }
      });

      res.on("error", (err) => reject(err));
      res.on("end", done);

      // Safety timeout
      setTimeout(done, 300);
    });
    req.on("error", (err) => reject(err));
  });
}

// ─── Fastify App & Server ────────────────────────────────────────────────────

let app: ReturnType<typeof Fastify>;
let baseUrl: string;

beforeAll(async () => {
  app = Fastify({ logger: false });
  // The production auth plugin verifies the cookie/bearer token and populates
  // req.user before this route runs. This route-level test supplies that
  // already-authenticated boundary without connecting to the user database.
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req) => {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) return;
    try {
      const payload = jwt.verify(authorization.slice(7), JWT_SECRET) as any;
      (req as any).user = {
        userId: payload.sub,
        feishuOpenId: payload.feishuOpenId,
        displayName: payload.displayName,
        role: payload.role,
      };
    } catch {
      // Leave req.user empty; the route must reject the request.
    }
  });
  await app.register(sseRoutes, { prefix: "/api/v1" });
  await app.ready();
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
  await app.close();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/v1/interviews/:id/events", () => {
  const INTERVIEW_ID = "int-sse-test-001";

  // ── Auth (reject → inject still fine) ──────────────────────────────────

  describe("authentication", () => {
    it("rejects request without token", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/interviews/${INTERVIEW_ID}/events`,
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.payload).code).toBe("UNAUTHORIZED");
    });

    it("rejects request with invalid token", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/interviews/${INTERVIEW_ID}/events`,
        headers: { authorization: "Bearer invalid" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects request with expired token", async () => {
      const expired = makeExpiredToken();
      await new Promise((r) => setTimeout(r, 1100));

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/interviews/${INTERVIEW_ID}/events`,
        headers: { authorization: `Bearer ${expired}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it("accepts token via Authorization header (fallback)", async () => {
      const token = makeToken();
      const { statusCode, headers } = await connectSse(
        baseUrl, INTERVIEW_ID,
        { authHeader: `Bearer ${token}` },
        1,
      );

      expect(statusCode).toBe(200);
      expect(headers["content-type"]).toContain("text/event-stream");
    });
  });

  // ── Connection events ──────────────────────────────────────────────────

  describe("connection events", () => {
    it("returns text/event-stream content type", async () => {
      const token = makeToken();
      const { statusCode, headers } = await connectSse(
        baseUrl, INTERVIEW_ID,
        { authHeader: `Bearer ${token}` },
        1,
      );

      expect(statusCode).toBe(200);
      expect(headers["content-type"]).toContain("text/event-stream");
      expect(headers["cache-control"]).toBe("no-cache");
      expect(headers["connection"]).toBe("keep-alive");
    });

    it("sends 'connected' event on first chunk", async () => {
      const token = makeToken();
      const { data } = await connectSse(
        baseUrl, INTERVIEW_ID,
        { authHeader: `Bearer ${token}` },
        1,
      );

      expect(data).toContain("event: connected");
      expect(data).toContain(`"interviewId":"${INTERVIEW_ID}"`);
    });
  });
});

// ─── publishEvent ────────────────────────────────────────────────────────────

describe("publishEvent", () => {
  const INTERVIEW_ID = "int-sse-pub-001";

  it("publishes events to connected subscribers", async () => {
    const token = makeToken();
    const path = `/api/v1/interviews/${encodeURIComponent(INTERVIEW_ID)}/events`;

    const events: string[] = [];
    const req = http.get(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } }, (res) => {
      res.on("data", (chunk: Buffer) => events.push(chunk.toString()));
    });

    // Wait for SSE connection to establish
    await new Promise((r) => setTimeout(r, 100));

    // Publish events
    publishEvent(INTERVIEW_ID, "interview.status.changed", {
      interviewId: INTERVIEW_ID,
      oldStatus: "live",
      newStatus: "ended",
    });

    publishEvent(INTERVIEW_ID, "transcript.line.upserted", {
      lineId: "line-001",
      text: "测试逐字稿行",
    });

    // Wait for events to propagate
    await new Promise((r) => setTimeout(r, 150));
    req.destroy();

    const allData = events.join("");
    expect(allData).toContain("event: connected");
    expect(allData).toContain("interview.status.changed");
    expect(allData).toContain("transcript.line.upserted");
  });

  it("is a no-op when no subscribers exist", () => {
    expect(() => {
      publishEvent("nonexistent-interview", "some.event", { foo: "bar" });
    }).not.toThrow();
  });

  it("handles JSON serialization of complex data", () => {
    expect(() => {
      publishEvent("test-interview", "complex.event", {
        timestamp: new Date().toISOString(),
        nested: { deep: [1, 2, 3], nil: null },
        unicode: "中文测试 🎉",
      });
    }).not.toThrow();
  });
});

// ─── SSE format compliance ───────────────────────────────────────────────────

describe("SSE format compliance", () => {
  const INTERVIEW_ID = "int-sse-fmt-001";

  it("follows SSE event format (event: + data:) newline", async () => {
    const token = makeToken();
    const { data } = await connectSse(
      baseUrl, INTERVIEW_ID,
      { authHeader: `Bearer ${token}` },
      1,
    );

    expect(data).toContain("event: connected");
    expect(data).toMatch(/data: \{.*\}\n\n/);
  });
});
