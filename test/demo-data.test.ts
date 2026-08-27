import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { InterviewPackageSchema, TranscriptLineSchema } from "@vice/contracts";

describe("synthetic demo data", () => {
  it("matches the public interview package schema", () => {
    const raw = readFileSync(resolve("demo-data/fake_interview_package.json"), "utf8");
    expect(InterviewPackageSchema.safeParse(JSON.parse(raw)).success).toBe(true);
  });

  it("contains only valid transcript line objects", () => {
    const rows = readFileSync(resolve("demo-data/fake_transcript.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => TranscriptLineSchema.safeParse(row).success)).toBe(true);
  });
});
