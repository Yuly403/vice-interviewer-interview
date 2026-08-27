/**
 * OAuth routes — Feishu web application OAuth 2.0 login flow.
 *
 * GET  /auth/feishu/redirect  — generate state, 302 → Feishu authorize page
 * GET  /auth/feishu/callback   — handle code callback, exchange for JWT
 */
import type { FastifyPluginAsync } from "fastify";
import { setSessionCookie, signToken } from "../plugins/auth.js";
import { findOrCreateUser } from "../services/user.js";
import {
  createOAuthState,
  consumeOAuthState,
  buildAuthorizationUrl,
  exchangeCodeForToken,
} from "../services/feishu-oauth.js";

export const oauthRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /auth/feishu/redirect → Feishu authorize ─────────────────────
  app.get("/auth/feishu/redirect", async (_req, reply) => {
    try {
      const state = createOAuthState();
      const url = buildAuthorizationUrl(state);
      return reply.code(302).redirect(url);
    } catch {
      return reply.code(503).send({
        code: "FEISHU_OAUTH_NOT_CONFIGURED",
        message: "飞书网页登录尚未配置。内网会后妙记试点不需要启用此能力。",
      });
    }
  });

  // ── GET /auth/feishu/callback → code exchange → JWT ─────────────────
  app.get("/auth/feishu/callback", async (req, reply) => {
    const { code, state, error: oauthError, error_description } = req.query as Record<string, string>;

    // User denied authorization or Feishu returned an error
    if (oauthError) {
      const msg = error_description || oauthError;
      const redirectUrl = `${process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"}/login?error=${encodeURIComponent(msg)}`;
      return reply.code(302).redirect(redirectUrl);
    }

    // Validate state (CSRF protection)
    if (!state || !consumeOAuthState(state)) {
      const redirectUrl = `${process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"}/login?error=${encodeURIComponent("安全校验失败，请重试")}`;
      return reply.code(302).redirect(redirectUrl);
    }

    // Require authorization code
    if (!code) {
      const redirectUrl = `${process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"}/login?error=${encodeURIComponent("缺少授权码")}`;
      return reply.code(302).redirect(redirectUrl);
    }

    // Exchange code for token + user info
    const tokenResult = await exchangeCodeForToken(code);
    if (!tokenResult.ok) {
      const msg = tokenResult.error?.message ?? "授权失败";
      console.error("[oauth] token exchange failed:", msg);
      const redirectUrl = `${process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"}/login?error=${encodeURIComponent(`飞书登录失败：${msg}`)}`;
      return reply.code(302).redirect(redirectUrl);
    }

    const { open_id, name, avatar_url, email, refresh_token, expires_in } = tokenResult.data;

    if (!open_id || !name) {
      const redirectUrl = `${process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"}/login?error=${encodeURIComponent("获取用户信息失败")}`;
      return reply.code(302).redirect(redirectUrl);
    }

    // Compute token expiry if provided
    const tokenExpiresAt = expires_in
      ? new Date(Date.now() + expires_in * 1000)
      : undefined;

    // Find or create user in our database
    let user;
    try {
      user = await findOrCreateUser({
        feishuOpenId: open_id,
        displayName: name,
        email: email ?? undefined,
        avatarUrl: avatar_url ?? undefined,
        refreshToken: refresh_token ?? undefined,
        tokenExpiresAt,
      });
    } catch (err) {
      console.error("[oauth] findOrCreateUser failed:", err);
      const redirectUrl = `${process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"}/login?error=${encodeURIComponent("创建用户失败，请重试")}`;
      return reply.code(302).redirect(redirectUrl);
    }

    // Issue JWT
    const token = signToken({
      sub: user.id,
      feishuOpenId: user.feishuOpenId,
      displayName: user.displayName,
      role: user.role,
    });

    // Keep JWTs out of URLs, browser history, referrers and access logs.
    setSessionCookie(reply, token);
    return reply.code(302).redirect(`${process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"}/`);
  });
};
