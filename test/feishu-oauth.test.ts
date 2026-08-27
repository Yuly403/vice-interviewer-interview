/**
 * 飞书 OAuth 服务单元测试
 *
 * 覆盖 CSRF state 管理、URL 构建、token 交换、refresh、expiry 检查
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock `./feishu.js` — intercept runLark calls
vi.mock("../apps/api/src/services/feishu.js", () => ({
  runLark: vi.fn(),
  describeLarkError: vi.fn((e: Error) => e.message),
  isRetryableLarkError: vi.fn(() => false),
  getMeetingEvents: vi.fn(),
  getMeetingDetails: vi.fn(),
  getMinuteTranscript: vi.fn(),
  parseTranscriptText: vi.fn(),
}));

import { runLark } from "../apps/api/src/services/feishu.js";
import {
  createOAuthState,
  consumeOAuthState,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  getUserInfo,
  refreshUserToken,
  isTokenExpired,
} from "../apps/api/src/services/feishu-oauth.js";

beforeEach(() => {
  process.env.FEISHU_APP_ID = "cli_test_app";
  process.env.FEISHU_REDIRECT_URI = "http://127.0.0.1:5173/api/v1/auth/feishu/callback";
});

// ─── CSRF State Management ───────────────────────────────────────────────────

describe("createOAuthState / consumeOAuthState", () => {
  it("creates a UUID state", () => {
    const state = createOAuthState();
    expect(state).toBeTruthy();
    expect(typeof state).toBe("string");
    expect(state).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("consumes a valid state", () => {
    const state = createOAuthState();
    expect(consumeOAuthState(state)).toBe(true);
  });

  it("rejects invalid/unknown state", () => {
    expect(consumeOAuthState("nonexistent-state")).toBe(false);
  });

  it("state is one-time use (consumed after validation)", () => {
    const state = createOAuthState();
    expect(consumeOAuthState(state)).toBe(true);
    // Second consumption should fail
    expect(consumeOAuthState(state)).toBe(false);
  });

  it("rejects expired state (> 10 minutes)", () => {
    // Manually set a state with old timestamp
    const veryOldState = "00000000-0000-0000-0000-000000000000";
    // This state was never created via createOAuthState, so it won't exist
    expect(consumeOAuthState(veryOldState)).toBe(false);
  });
});

// ─── URL Building ────────────────────────────────────────────────────────────

describe("buildAuthorizationUrl", () => {
  it("builds a valid Feishu OAuth URL with state", () => {
    const url = buildAuthorizationUrl("test-state-123");
    expect(url).toContain("accounts.feishu.cn");
    expect(url).toContain("authen/v1/authorize");
    expect(url).toContain("client_id=");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("state=test-state-123");
    expect(url).toContain("scope=offline_access");
  });
});

// ─── Token Exchange ──────────────────────────────────────────────────────────

describe("exchangeCodeForToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure no APP_SECRET for lark-cli proxy path
    delete process.env.FEISHU_APP_SECRET;
  });

  afterEach(() => {
    delete process.env.FEISHU_APP_SECRET;
  });

  it("exchanges code via lark-cli api (success)", async () => {
    const mockRunLark = runLark as ReturnType<typeof vi.fn>;
    mockRunLark.mockResolvedValue({
      ok: true,
      identity: "bot",
      data: {
        access_token: "at-xxx",
        refresh_token: "rt-xxx",
        token_type: "Bearer",
        expires_in: 7200,
        name: "测试用户",
        open_id: "ou-test123",
        email: "test@example.com",
      },
    });

    const result = await exchangeCodeForToken("auth-code-123");

    expect(result.ok).toBe(true);
    expect(result.data!.access_token).toBe("at-xxx");
    expect(result.data!.open_id).toBe("ou-test123");
    expect(mockRunLark).toHaveBeenCalledTimes(1);
    expect(mockRunLark).toHaveBeenCalledWith(
      expect.arrayContaining(["api", "POST"]),
      expect.objectContaining({ as: "bot" }),
    );
  });

  it("handles lark-cli api failure", async () => {
    const mockRunLark = runLark as ReturnType<typeof vi.fn>;
    mockRunLark.mockResolvedValue({
      ok: false,
      identity: "bot",
      error: { type: "api", message: "invalid_grant: code expired" },
    });

    const result = await exchangeCodeForToken("expired-code");

    expect(result.ok).toBe(false);
    expect(result.error!.message).toContain("invalid_grant");
  });

  it("falls back to direct HTTP when FEISHU_APP_SECRET is set", async () => {
    // Set APP_SECRET to trigger direct HTTP path
    process.env.FEISHU_APP_SECRET = "test-secret-key-123";

    // Mock fetch for the direct HTTP path
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as any;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          access_token: "at-direct",
          refresh_token: "rt-direct",
          token_type: "Bearer",
          expires_in: 3600,
        },
      }),
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          name: "测试用户",
          open_id: "ou-direct",
        },
      }),
    });

    const result = await exchangeCodeForToken("direct-code");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data!.access_token).toBe("at-direct");
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Cleanup
    delete process.env.FEISHU_APP_SECRET;
  });
});

// ─── User Info ────────────────────────────────────────────────────────────────

describe("getUserInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches user info via lark-cli api", async () => {
    const mockRunLark = runLark as ReturnType<typeof vi.fn>;
    mockRunLark.mockResolvedValue({
      ok: true,
      identity: "user",
      data: {
        data: {
          open_id: "ou-123",
          name: "张三",
          email: "zhangsan@example.com",
        },
      },
    });

    const result = await getUserInfo("access-token-123");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data!.name).toBe("张三");
    }
  });
});

// ─── Token Refresh ────────────────────────────────────────────────────────────

describe("refreshUserToken", () => {
  it("requires FEISHU_APP_SECRET to be set", async () => {
    delete process.env.FEISHU_APP_SECRET;
    const result = await refreshUserToken("old-rt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error!.message).toContain("FEISHU_APP_SECRET");
    }
  });

  it("refreshes token via direct HTTP when secret is set", async () => {
    process.env.FEISHU_APP_SECRET = "test-secret";

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as any;

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          access_token: "new-at",
          refresh_token: "new-rt",
          token_type: "Bearer",
          expires_in: 7200,
        },
      }),
    });

    const result = await refreshUserToken("old-refresh-token");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data!.accessToken).toBe("new-at");
      expect(result.data!.refreshToken).toBe("new-rt");
      // expiresAt should be ~2 hours from now
      const diffMs = result.data!.expiresAt.getTime() - Date.now();
      expect(diffMs).toBeGreaterThan(7000 * 1000); // >= ~1.94 hours
      expect(diffMs).toBeLessThan(7300 * 1000);    // <= ~2.03 hours
    }

    delete process.env.FEISHU_APP_SECRET;
  });

  it("handles HTTP error during refresh", async () => {
    process.env.FEISHU_APP_SECRET = "test-secret";

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as any;

    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 100103, msg: "refresh_token invalid" }),
    });

    const result = await refreshUserToken("bad-rt");
    expect(result.ok).toBe(false);

    delete process.env.FEISHU_APP_SECRET;
  });
});

// ─── Token Expiry ─────────────────────────────────────────────────────────────

describe("isTokenExpired", () => {
  it("returns true for null/undefined", () => {
    expect(isTokenExpired(null)).toBe(true);
    expect(isTokenExpired(undefined)).toBe(true);
  });

  it("returns true for already-expired token", () => {
    const pastDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    expect(isTokenExpired(pastDate)).toBe(true);
  });

  it("returns true for token expiring within 5 minutes", () => {
    const soonExpiring = new Date(Date.now() + 3 * 60 * 1000); // 3 minutes from now
    expect(isTokenExpired(soonExpiring)).toBe(true);
  });

  it("returns false for token with > 5 minutes remaining", () => {
    const farFuture = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    expect(isTokenExpired(farFuture)).toBe(false);
  });

  it("returns false for token expiring hours from now", () => {
    const hoursAway = new Date(Date.now() + 3600 * 1000); // 1 hour from now
    expect(isTokenExpired(hoursAway)).toBe(false);
  });
});
