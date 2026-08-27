import { describe, expect, it } from "vitest";
import { parsePlanGenOutput } from "@vice/llm";
import {
  PLAN_PROMPT_VERSION,
  classifyLlmFailure,
  parsePlanGenerationMeta,
} from "../apps/api/src/services/plan-generation.js";

describe("classifyLlmFailure", () => {
  it.each([
    [new Error("LLM request timeout"), "timeout"],
    [new Error("LLM API error: unauthorized"), "api_error"],
    [new SyntaxError("Unexpected token"), "invalid_json"],
    [new Error("LLM returned empty output"), "empty_output"],
    [new Error("socket hang up"), "api_error"],
  ])("classifies %s", (error, expected) => {
    expect(classifyLlmFailure(error)).toBe(expected);
  });

  it("classifies schema validation failures without exposing validation data", () => {
    let captured: unknown;
    try {
      parsePlanGenOutput(JSON.stringify({ topics: [] }));
    } catch (error) {
      captured = error;
    }
    expect(classifyLlmFailure(captured)).toBe("invalid_schema");
  });
});

describe("parsePlanGenerationMeta", () => {
  const valid = {
    mode: "llm",
    model: "deepseek-v4-flash",
    promptVersion: PLAN_PROMPT_VERSION,
    durationMs: 325,
    totalTokens: 109,
    generatedAt: "2026-08-11T06:00:00.000Z",
  };

  it("parses valid persisted metadata", () => {
    expect(parsePlanGenerationMeta(JSON.stringify(valid))).toEqual(valid);
  });

  it("returns null for malformed or unexpected metadata", () => {
    expect(parsePlanGenerationMeta("not-json")).toBeNull();
    expect(parsePlanGenerationMeta(JSON.stringify({ ...valid, apiKey: "secret" }))).toBeNull();
    expect(parsePlanGenerationMeta(null)).toBeNull();
  });
});
