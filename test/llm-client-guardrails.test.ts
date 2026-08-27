import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("node:https", () => ({ default: { request: requestMock } }));

import { chat } from "@vice/llm";

function mockResponse(statusCode: number, body: string | Buffer) {
  let written = "";
  requestMock.mockImplementation((_options: unknown, callback: (response: any) => void) => {
    const request = new EventEmitter() as any;
    request.write = vi.fn((chunk: string) => { written += chunk; });
    request.destroy = vi.fn();
    request.end = vi.fn(() => {
      const response = new EventEmitter() as any;
      response.statusCode = statusCode;
      response.destroy = vi.fn();
      callback(response);
      queueMicrotask(() => {
        response.emit("data", Buffer.isBuffer(body) ? body : Buffer.from(body));
        response.emit("end");
      });
    });
    return request;
  });
  return () => written;
}

const config = {
  baseUrl: "https://model.example.test/v1",
  apiKey: "test-key",
  model: "test-model",
  timeoutSec: 1,
};

describe("LLM transport guardrails", () => {
  beforeEach(() => requestMock.mockReset());

  it("rejects non-HTTPS model endpoints", async () => {
    await expect(chat({ ...config, baseUrl: "http://model.example.test/v1" }, [])).rejects.toThrow("HTTPS");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("rejects non-success HTTP responses without exposing the body", async () => {
    mockResponse(401, JSON.stringify({ error: { message: "secret upstream detail" } }));
    await expect(chat(config, [])).rejects.toThrow("HTTP 401");
  });

  it("rejects an oversized response before parsing it", async () => {
    mockResponse(200, Buffer.alloc(2 * 1024 * 1024 + 1, 65));
    await expect(chat(config, [])).rejects.toThrow("maximum allowed size");
  });

  it("validates the response envelope and always sends a bounded max_tokens", async () => {
    const written = mockResponse(200, JSON.stringify({
      id: "completion-1",
      object: "chat.completion",
      model: "test-model",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    }));

    await expect(chat(config, [], 100_000)).resolves.toMatchObject({ content: "ok", finishReason: "stop" });
    expect(JSON.parse(written()).max_tokens).toBe(8_192);
  });
});
