/**
 * Feishu OAuth service — handles the OAuth 2.0 authorization code flow
 * via lark-cli api subprocess. No app_secret is exposed to application code.
 *
 * Flow:
 *   1. Frontend → /auth/feishu/redirect → Feishu authorize page
 *   2. User authorizes → Feishu redirects to /auth/feishu/callback?code=xxx&state=xxx
 *   3. Backend exchanges code for user_access_token via lark-cli api
 *   4. Backend fetches user_info, findOrCreateUser, issues JWT
 *   5. Backend sets an HttpOnly session cookie and redirects to the frontend
 */

import crypto from "node:crypto";
import { runLark, type LarkResult } from "./feishu.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const FEISHU_AUTH_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";

function getOAuthConfig(): { appId: string; redirectUri: string } {
  const appId = process.env.FEISHU_APP_ID;
  const redirectUri = process.env.FEISHU_REDIRECT_URI;
  if (!appId || !redirectUri) {
    throw new Error("FEISHU_APP_ID and FEISHU_REDIRECT_URI must be configured before Feishu OAuth is enabled.");
  }
  return { appId, redirectUri };
}

// ─── CSRF State Store ───────────────────────────────────────────────────────

interface StateEntry {
  createdAt: number;
}

const stateStore = new Map<string, StateEntry>();

/** Clean up states older than 10 minutes every 5 minutes. */
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of stateStore) {
    if (val.createdAt < cutoff) stateStore.delete(key);
  }
}, 5 * 60 * 1000);

/** Generate a CSRF state, store it, and return it. */
export function createOAuthState(): string {
  const state = crypto.randomUUID();
  stateStore.set(state, { createdAt: Date.now() });
  return state;
}

/** Validate and consume a CSRF state. Returns true if valid. */
export function consumeOAuthState(state: string): boolean {
  const entry = stateStore.get(state);
  if (!entry) return false;
  stateStore.delete(state);
  // States older than 10 minutes are invalid
  if (Date.now() - entry.createdAt > 10 * 60 * 1000) return false;
  return true;
}

// ─── Build Authorization URL ────────────────────────────────────────────────

/** Build the Feishu OAuth authorize URL with state. */
export function buildAuthorizationUrl(state: string): string {
  const { appId, redirectUri } = getOAuthConfig();
  const params = new URLSearchParams({
    client_id: appId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: "offline_access",
  });
  return `${FEISHU_AUTH_URL}?${params.toString()}`;
}

// ─── OIDC Token Exchange ───────────────────────────────────────────────────

export interface OidcTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  name: string;
  avatar_url?: string;
  avatar_thumb?: string;
  avatar_middle?: string;
  avatar_big?: string;
  open_id: string;
  union_id?: string;
  en_name?: string;
  tenant_key?: string;
  email?: string;
  mobile?: string;
}

/**
 * Exchange an authorization code for user tokens + user info.
 * Uses lark-cli api to proxy the OIDC access_token request.
 *
 * Note: lark-cli api auto-injects app credentials. If this fails,
 * set FEISHU_APP_SECRET in environment and the fallback direct-HTTP
 * path will be used.
 */
export async function exchangeCodeForToken(
  code: string,
): Promise<LarkResult<OidcTokenResponse>> {
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (appSecret) {
    // ── Direct HTTP path (with explicit app_secret) ──
    return exchangeCodeDirect(code, appSecret);
  }

  // ── lark-cli api proxy path ──
  const body = JSON.stringify({
    grant_type: "authorization_code",
    code,
  });

  const result = await runLark<any>(
    ["api", "POST", "/open-apis/authen/v1/oidc/access_token", "--data", body],
    { as: "bot", timeoutMs: 15_000 },
  );

  if (!result.ok) {
    // Check if the error suggests missing app_secret
    const errMsg = result.error?.message ?? "";
    if (errMsg.includes("app_secret") || errMsg.includes("client_secret") || errMsg.includes("Bad Request")) {
      return {
        ok: false,
        identity: "bot",
        error: {
          type: "oauth",
          message:
            "lark-cli api 无法完成 OIDC 授权码交换。请在 .env 中配置 FEISHU_APP_SECRET（从飞书开放平台 → 应用凭证获取）。",
        },
      };
    }
    return result;
  }

  const data = result.data;
  // lark-cli wraps API response in various shapes — normalize
  if (data?.data) {
    return { ...result, data: data.data as OidcTokenResponse };
  }
  return { ...result, data: data as OidcTokenResponse };
}

/** Direct HTTP exchange — used when FEISHU_APP_SECRET is configured. */
async function exchangeCodeDirect(
  code: string,
  appSecret: string,
): Promise<LarkResult<OidcTokenResponse>> {
  try {
    const { appId, redirectUri } = getOAuthConfig();
    const res = await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const json = await res.json() as any;

    if (!res.ok || (typeof json.code === "number" && json.code !== 0) || json.error) {
      return {
        ok: false,
        identity: "bot",
        error: {
          type: "oauth",
          code: json.code ?? json.error,
          message: json.msg || json.error_description || json.error || `OIDC token exchange failed: HTTP ${res.status}`,
        },
      };
    }

    const tokenData = json.data ?? json;
    if (!tokenData.access_token) {
      return {
        ok: false,
        identity: "bot",
        error: { type: "oauth", message: "OIDC response missing access_token field" },
      };
    }

    const userInfoResult = await fetch("https://open.feishu.cn/open-apis/authen/v1/user_info", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfoJson = await userInfoResult.json() as any;
    if (!userInfoResult.ok || userInfoJson.code !== 0 || !userInfoJson.data) {
      return {
        ok: false,
        identity: "bot",
        error: {
          type: "oauth",
          code: userInfoJson.code,
          message: userInfoJson.msg || `Feishu user_info failed: HTTP ${userInfoResult.status}`,
        },
      };
    }

    return {
      ok: true,
      identity: "bot",
      data: {
        ...tokenData,
        ...userInfoJson.data,
      } as OidcTokenResponse,
    };
  } catch (e) {
    return {
      ok: false,
      identity: "bot",
      error: {
        type: "network",
        message: `OIDC token exchange network error: ${(e as Error).message}`,
      },
    };
  }
}

// ─── User Info ──────────────────────────────────────────────────────────────

export interface FeishuUserInfo {
  open_id: string;
  union_id?: string;
  name: string;
  en_name?: string;
  avatar_url?: string;
  email?: string;
  mobile?: string;
  tenant_key?: string;
}

/**
 * Get Feishu user info using user_access_token.
 * Falls back to extracting info from the OIDC token response if the API call fails.
 */
export async function getUserInfo(userAccessToken: string): Promise<LarkResult<FeishuUserInfo>> {
  // Try lark-cli api first
  const result = await runLark<any>(
    ["api", "GET", "/open-apis/authen/v1/user_info", "--params", JSON.stringify({})],
    { as: "user", timeoutMs: 10_000 },
  );

  if (result.ok && result.data) {
    const data = result.data?.data ?? result.data;
    return { ...result, data: data as FeishuUserInfo };
  }

  // Fallback: direct HTTP call with the user access token
  try {
    const res = await fetch(
      "https://open.feishu.cn/open-apis/authen/v1/user_info",
      { headers: { Authorization: `Bearer ${userAccessToken}` } },
    );
    const json = await res.json() as any;
    if (res.ok && json.code === 0 && json.data) {
      return { ok: true, identity: "user", data: json.data as FeishuUserInfo };
    }
  } catch { /* fall through to error */ }

  return result;
}

// ─── Token Refresh ──────────────────────────────────────────────────────────

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  open_id?: string;
  name?: string;
}

/**
 * Refresh a user's access token using their stored refresh_token.
 * Used when the access token has expired and we need long-lived API access.
 *
 * Returns new tokens + expiry timestamp, which the caller should persist.
 */
export async function refreshUserToken(
  refreshToken: string,
): Promise<LarkResult<{ accessToken: string; refreshToken: string; expiresAt: Date }>> {
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appSecret) {
    return {
      ok: false,
      identity: "bot",
      error: {
        type: "oauth",
        message: "Token refresh requires FEISHU_APP_SECRET to be configured.",
      },
    };
  }

  try {
    const { appId } = getOAuthConfig();
    const res = await fetch("https://open.feishu.cn/open-apis/authen/v1/oidc/refresh_access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: appId,
        client_secret: appSecret,
        refresh_token: refreshToken,
      }),
    });

    const json = await res.json() as any;

    if (!res.ok || json.code !== 0) {
      return {
        ok: false,
        identity: "bot",
        error: {
          type: "oauth",
          code: json.code,
          message: json.msg || `Token refresh failed: HTTP ${res.status}`,
        },
      };
    }

    const data = json.data as RefreshTokenResponse;
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    return {
      ok: true,
      identity: "bot",
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
      },
    };
  } catch (e) {
    return {
      ok: false,
      identity: "bot",
      error: {
        type: "network",
        message: `Token refresh network error: ${(e as Error).message}`,
      },
    };
  }
}

/**
 * Check if a stored access token is expired (or about to expire in 5 minutes).
 */
export function isTokenExpired(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return true;
  // Consider expired 5 minutes before actual expiry for safety margin
  return Date.now() >= expiresAt.getTime() - 5 * 60 * 1000;
}
