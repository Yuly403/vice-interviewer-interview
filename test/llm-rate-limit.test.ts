import { beforeEach, describe, expect, it, vi } from "vitest";
import { enforceLlmRateLimit, resetLlmRateLimitsForTests } from "../apps/api/src/services/llm-rate-limit.js";

function fakeReply() {
  const reply: any = {
    header: vi.fn(),
    status: vi.fn(),
    send: vi.fn(),
  };
  reply.header.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);
  reply.send.mockReturnValue(reply);
  return reply;
}

describe("LLM generation rate limit", () => {
  beforeEach(() => resetLlmRateLimitsForTests());

  it("allows normal generation and blocks repeated requests for one interview", () => {
    const req = { user: { userId: "user-1" } } as any;
    for (let index = 0; index < 4; index++) {
      expect(enforceLlmRateLimit(req, fakeReply(), "plan", "interview-1")).toBe(true);
    }

    const blockedReply = fakeReply();
    expect(enforceLlmRateLimit(req, blockedReply, "plan", "interview-1")).toBe(false);
    expect(blockedReply.status).toHaveBeenCalledWith(429);
    expect(blockedReply.header).toHaveBeenCalledWith("Retry-After", expect.any(String));
    expect(blockedReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: "LLM_RATE_LIMITED" }));
  });

  it("keeps different interviews in separate action buckets", () => {
    const req = { user: { userId: "user-2" } } as any;
    for (let index = 0; index < 4; index++) {
      expect(enforceLlmRateLimit(req, fakeReply(), "review", "interview-a")).toBe(true);
    }
    expect(enforceLlmRateLimit(req, fakeReply(), "review", "interview-b")).toBe(true);
  });

  it("does not consume an interview bucket after the user is already blocked", () => {
    const noisyUser = { user: { userId: "noisy-user" } } as any;
    for (let index = 0; index < 10; index++) {
      expect(enforceLlmRateLimit(noisyUser, fakeReply(), "plan", `unique-${index}`)).toBe(true);
    }
    expect(enforceLlmRateLimit(noisyUser, fakeReply(), "plan", "shared-interview")).toBe(false);

    const otherUser = { user: { userId: "other-user" } } as any;
    for (let index = 0; index < 4; index++) {
      expect(enforceLlmRateLimit(otherUser, fakeReply(), "plan", "shared-interview")).toBe(true);
    }
  });
});
