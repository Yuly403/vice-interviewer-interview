/**
 * Auth Routes — Login, current user, and token refresh.
 *
 * Public endpoints (no JWT required):
 *   POST /api/v1/auth/login  — exchange feishuOpenId for JWT token
 *
 * Protected endpoints (JWT required):
 *   GET  /api/v1/auth/me      — get current user info
 *   POST /api/v1/auth/refresh — refresh token
 */
import type { FastifyPluginAsync } from "fastify";
import type { RequestUser } from "../plugins/auth.js";
import { clearSessionCookie, isMockAuthEnabled, setSessionCookie, signToken } from "../plugins/auth.js";
import { findOrCreateUser, getUserById } from "../services/user.js";
import { refreshUserToken, isTokenExpired } from "../services/feishu-oauth.js";
import { prisma } from "../db.js";
import { decryptSecret } from "../services/secret-crypto.js";

// ─── Login request body ───
interface LoginBody {
  feishuOpenId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  // ── POST /auth/login (development/test only) ──
  app.post<{ Body: LoginBody }>("/auth/login", async (req, reply) => {
    if (!isMockAuthEnabled()) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Not found" });
    }
    const { feishuOpenId, displayName, email, avatarUrl } = req.body;

    if (!feishuOpenId || !displayName) {
      return reply.status(400).send({
        code: "BAD_REQUEST",
        message: "feishuOpenId and displayName are required",
      });
    }

    // Find or create user
    const user = await findOrCreateUser({
      feishuOpenId,
      displayName,
      email,
      avatarUrl,
    });

    // Issue JWT
    const token = signToken({
      sub: user.id,
      feishuOpenId: user.feishuOpenId,
      displayName: user.displayName,
      role: user.role,
    });

    setSessionCookie(reply, token);
    return {
      data: {
        user: {
          id: user.id,
          feishuOpenId: user.feishuOpenId,
          displayName: user.displayName,
          email: user.email,
          role: user.role,
          avatarUrl: user.avatarUrl,
        },
      },
    };
  });

  // ── GET /auth/me (protected) ──
  app.get("/auth/me", async (req, reply) => {
    const reqUser = req.user as RequestUser;
    if (!reqUser) {
      return reply.status(401).send({ code: "UNAUTHORIZED", message: "Not authenticated" });
    }

    const user = await getUserById(reqUser.userId);
    if (!user) {
      return reply.status(404).send({ code: "USER_NOT_FOUND", message: "User not found" });
    }

    return {
      data: {
        id: user.id,
        feishuOpenId: user.feishuOpenId,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    };
  });

  // ── POST /auth/refresh (protected) ──
  app.post("/auth/refresh", async (req, reply) => {
    const reqUser = req.user as RequestUser;
    if (!reqUser) {
      return reply.status(401).send({ code: "UNAUTHORIZED", message: "Not authenticated" });
    }

    // Rotate the HttpOnly session cookie; tokens are never returned in JSON.
    const token = signToken({
      sub: reqUser.userId,
      feishuOpenId: reqUser.feishuOpenId,
      displayName: reqUser.displayName,
      role: reqUser.role,
    });

    setSessionCookie(reply, token);
    return { data: { refreshed: true } };
  });

  // ── POST /auth/feishu/refresh (protected) ──
  // Refreshes the stored Feishu OIDC refresh_token for long-lived API access.
  app.post("/auth/feishu/refresh", async (req, reply) => {
    const reqUser = req.user as RequestUser;
    if (!reqUser) {
      return reply.status(401).send({ code: "UNAUTHORIZED", message: "Not authenticated" });
    }

    const user = await getUserById(reqUser.userId);
    if (!user) {
      return reply.status(404).send({ code: "USER_NOT_FOUND", message: "User not found" });
    }

    if (!user.feishuRefreshTokenEncrypted) {
      return reply.status(400).send({
        code: "NO_REFRESH_TOKEN",
        message: "No Feishu refresh_token stored. Re-authenticate via OAuth to obtain one.",
      });
    }

    // Only refresh if expired (with 5-minute safety margin) unless force=true
    const force = (req.body as any)?.force === true;
    if (!force && !isTokenExpired(user.feishuTokenExpiresAt)) {
      return {
        data: {
          refreshed: false,
          message: "Token is still valid",
          expiresAt: user.feishuTokenExpiresAt?.toISOString() ?? null,
        },
      };
    }

    let refreshToken: string;
    try {
      refreshToken = decryptSecret(user.feishuRefreshTokenEncrypted);
    } catch {
      return reply.status(500).send({ code: "TOKEN_DECRYPTION_FAILED", message: "Stored Feishu token cannot be used safely" });
    }
    const result = await refreshUserToken(refreshToken);

    if (!result.ok) {
      return reply.status(502).send({
        code: "REFRESH_FAILED",
        message: `Feishu token refresh failed: ${result.error?.message ?? "unknown error"}`,
      });
    }

    // Persist new tokens
    await prisma.user.update({
      where: { id: user.id },
      data: {
        feishuRefreshToken: null,
        feishuRefreshTokenEncrypted: (await import("../services/secret-crypto.js")).encryptSecret(result.data.refreshToken),
        feishuTokenExpiresAt: result.data.expiresAt,
      },
    });

    return {
      data: {
        refreshed: true,
        expiresAt: result.data.expiresAt.toISOString(),
      },
    };
  });

  app.post("/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { data: { loggedOut: true } };
  });
};
