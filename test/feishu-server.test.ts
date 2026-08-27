import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getServerMinuteTranscript,
  resolveMinuteToken,
} from "../apps/api/src/services/feishu-server.js";

function response(payload: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => payload } as Response;
}

describe("Feishu server adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a Minutes token without a local CLI or browser profile", async () => {
    process.env.FEISHU_APP_ID = "cli_test_app";
    process.env.FEISHU_APP_SECRET = "synthetic-test-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ code: 0, tenant_access_token: "synthetic-tenant-token", expire: 7200 }))
      .mockResolvedValueOnce(response({ code: 0, data: { meeting: { minute_token: "minute-token-123" } } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveMinuteToken("123456");

    expect(result).toEqual({ ok: true, data: "minute-token-123" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/vc/v1/meetings/123456");
  });

  it("normalizes a nested Minutes transcript response into evidence lines", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      code: 0,
      data: {
        transcript: {
          paragraphs: [{
            speaker_id: "ou_test",
            speaker_name: "测试候选人",
            start_time: 1720000000,
            sentences: [{ sentence_id: "sentence-1", text: "我负责了核心指标的提升。" }],
          }],
        },
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getServerMinuteTranscript("minute-token-123");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.lines).toHaveLength(1);
      expect(result.data.lines[0]).toMatchObject({
        speaker_id: "ou_test",
        speaker_name: "测试候选人",
        sentence_id: "sentence-1",
        text: "我负责了核心指标的提升。",
      });
    }
  });
});
