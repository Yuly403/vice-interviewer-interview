/**
 * Auth Plugin — JWT authentication + user context injection
 *
 * - Verifies Bearer token on all protected routes
 * - Injects `req.user` with { userId, feishuOpenId, displayName, role }
 * - Skip-list: /health, /auth/*, OPTIONS (CORS preflight)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";

// ─── JWT Payload ───
export interface JwtPayload {
  sub: string;           // userId
  feishuOpenId: string;
  displayName: string;
  role: string;
  iat: number;
  exp: number;
}

// ─── User context on request ───
export interface RequestUser {
  userId: string;
  feishuOpenId: string;
  displayName: string;
  role: string;
}

// Extend Fastify request type
declare module "fastify" {
  interface FastifyRequest {
    user?: RequestUser;
  }
}

// ─── Public route patterns (no auth required) ───
const PUBLIC_PATTERNS = [
  { method: "GET", path: "/api/v1/health" },
  { method: "GET", path: "/api/v1/health/live" },
  { method: "GET", path: "/api/v1/health/ready" },
  { method: "GET", path: "/api/v1/auth/feishu/redirect" },
  { method: "GET", path: "/api/v1/auth/feishu/callback" },
  { method: "POST", path: "/api/v1/auth/login" },
  { method: "OPTIONS" },  // CORS preflight
];

const SESSION_COOKIE = "vice_session";

function shouldUseSecureSessionCookie(): boolean {
  const configured = process.env.SESSION_COOKIE_SECURE;
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
}

/**
 * Mock authentication is deliberately opt-in.  A development build must set
 * ALLOW_MOCK_AUTH=true; production can never enable it accidentally.
 */
export function isMockAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_MOCK_AUTH === "true";
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const item of cookieHeader.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const secure = shouldUseSecureSessionCookie() ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`,
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  const secure = shouldUseSecureSessionCookie() ? "; Secure" : "";
  reply.header("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function isPublic(req: FastifyRequest): boolean {
  // Strip query string for path matching
  const url = req.url.split("?")[0];
  const matched = PUBLIC_PATTERNS.some((p) => {
    if (p.method && req.method !== p.method) return false;
    if (p.path && url !== p.path) return false;
    return true;
  });
  if (matched) return true;

  return false;
}

// ─── JWT Helpers ───
function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET must be set in environment variables");
  }
  return secret;
}

export function signToken(payload: Omit<JwtPayload, "iat" | "exp">): string {
  const expiresIn = process.env.JWT_EXPIRES_IN || "24h";
  return jwt.sign(payload, getSecret(), { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret()) as JwtPayload;
}

async function canAccessInterview(user: RequestUser, interviewId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  const interview = await prisma.interview.findFirst({
    where: {
      id: interviewId,
      OR: [
        { ownerUserId: user.userId },
        { participants: { some: { userId: user.userId } } },
        { participants: { some: { feishuOpenId: user.feishuOpenId } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(interview);
}

function interviewIdFromPath(url: string): string | undefined {
  const pathname = url.split("?")[0];
  if (pathname === "/api/v1/interviews/import") return undefined;
  const match = /^\/api\/v1\/interviews\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function allowedBrowserOrigins(): Set<string> {
  return new Set(
    (process.env.CORS_ORIGIN ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function isStateChangingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

/** Quick admin check — use on admin-only routes */
export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const user = req.user as RequestUser | undefined;
  if (!user || user.role !== "admin") {
    reply.status(403).send({ code: "FORBIDDEN", message: "Admin access required" });
    return false;
  }
  return true;
}

// ─── Fastify Plugin ───
async function authPlugin(app: FastifyInstance) {
  // Decorate: on every request, verify JWT if present
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    // Skip public routes
    if (isPublic(req)) return;

    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const cookieToken = bearerToken ? undefined : readCookie(req, SESSION_COOKIE);
    const token = bearerToken ?? cookieToken;
    if (!token) {
      return reply.status(401).send({
        code: "UNAUTHORIZED",
        message: "Missing or malformed Authorization header",
      });
    }

    // Cookie-authenticated mutations must originate from the configured web
    // application. Bearer-token API clients are not subject to browser CSRF.
    if (cookieToken && isStateChangingMethod(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !allowedBrowserOrigins().has(origin)) {
        return reply.status(403).send({
          code: "INVALID_ORIGIN",
          message: "State-changing cookie requests must come from an allowed browser origin",
        });
      }
    }

    try {
      const payload = verifyToken(token);
      // Authorization is based on the current database record, not claims
      // copied into an older JWT. Deleting a user or changing their role takes
      // effect on the next request and cannot be undone by /auth/refresh.
      const currentUser = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, feishuOpenId: true, displayName: true, role: true },
      });
      if (!currentUser || currentUser.feishuOpenId !== payload.feishuOpenId) {
        return reply.status(401).send({
          code: "SESSION_REVOKED",
          message: "The authenticated user no longer exists or the session has been revoked",
        });
      }
      req.user = {
        userId: currentUser.id,
        feishuOpenId: currentUser.feishuOpenId,
        displayName: currentUser.displayName,
        role: currentUser.role,
      };

      const interviewId = interviewIdFromPath(req.url);
      if (interviewId && !(await canAccessInterview(req.user, interviewId))) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "You do not have access to this interview",
        });
      }
    } catch (err: any) {
      const code = err.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "INVALID_TOKEN";
      return reply.status(401).send({
        code,
        message: err.message || "Invalid or expired token",
      });
    }
  });
}

export default fp(authPlugin, { name: "auth" });
