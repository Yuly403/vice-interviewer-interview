import { describe, it, expect } from "vitest";
import {
  detectSyncConflicts,
  parseExistingSyncMeta,
  isAutoResolvable,
} from "@vice/domain";
import type {
  DetectionInput,
  DetectionDraft,
  DetectionTranscriptLine,
} from "@vice/domain";
import { ConflictType as CT } from "@vice/contracts";

// ─── Test fixtures ───

function makeDraft(overrides: Partial<DetectionDraft> = {}): DetectionDraft {
  return {
    revision: 3,
    suggestedDecision: "pass",
    humanDecision: "pass",
    overview: "候选人整体表现出色，技术功底扎实。",
    strengths: ["技术能力强", "沟通表达清晰"],
    risks: ["项目经验偏窄"],
    conclusions: [
      {
        dimension: "技术深度",
        text: "对分布式系统理解深入，能清晰解释 CAP 理论。",
        evidenceRefs: [
          { sourceId: "line-1", sourceRevision: 2, quote: "CAP理论的核心是取舍" },
          { sourceId: "line-2", sourceRevision: 1, quote: "在实际项目中我们选择了AP" },
        ],
      },
      {
        dimension: "沟通协作",
        text: "表达清晰，有良好的团队协作意识。",
        evidenceRefs: [
          { sourceId: "line-3", sourceRevision: 1, quote: "我会主动同步信息" },
        ],
      },
    ],
    ...overrides,
  };
}

function makeTranscriptLines(overrides: Partial<DetectionTranscriptLine>[] = []): DetectionTranscriptLine[] {
  const base: DetectionTranscriptLine[] = [
    { id: "line-1", revision: 2, isDeleted: false, text: "CAP理论的核心是取舍，不能同时满足三者" },
    { id: "line-2", revision: 1, isDeleted: false, text: "在实际项目中我们选择了AP模型" },
    { id: "line-3", revision: 1, isDeleted: false, text: "我会主动同步信息给团队成员" },
  ];
  for (const override of overrides) {
    const idx = base.findIndex((l) => l.id === override.id);
    if (idx >= 0) Object.assign(base[idx], override);
  }
  return base;
}

// ─── Tests ───

describe("sync-conflict-detector", () => {
  // ═══════════════════════════════════════════════
  // Happy path — no conflicts
  // ═══════════════════════════════════════════════
  describe("happy path — no conflicts", () => {
    it("should return empty conflicts when everything is consistent", () => {
      const input: DetectionInput = {
        draft: makeDraft(),
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts).toHaveLength(0);
      expect(result.conflictTypes).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  // stale_line tests
  // ═══════════════════════════════════════════════
  describe("stale_line detection", () => {
    it("should detect when transcript line does not exist", () => {
      const draft = makeDraft({
        conclusions: [
          {
            dimension: "技术深度",
            text: "...",
            evidenceRefs: [{ sourceId: "line-missing", sourceRevision: 1, quote: "test" }],
          },
        ],
      });
      const input: DetectionInput = {
        draft,
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflictTypes).toContain("stale_line");
      const staleConflicts = result.conflicts.filter((c) => c.type === CT.StaleLine);
      expect(staleConflicts.length).toBeGreaterThanOrEqual(1);
      expect(staleConflicts[0].message).toContain("已不存在");
    });

    it("should detect when transcript line is deleted", () => {
      const input: DetectionInput = {
        draft: makeDraft(),
        transcriptLines: makeTranscriptLines([{ id: "line-1", revision: 2, isDeleted: true, text: "..." }]),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      const deletedConflicts = result.conflicts.filter(
        (c) => c.type === CT.StaleLine && c.message.includes("已被标记为删除")
      );
      expect(deletedConflicts.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect when transcript line revision is stale", () => {
      const input: DetectionInput = {
        draft: makeDraft(),
        transcriptLines: makeTranscriptLines([{ id: "line-1", revision: 5, isDeleted: false, text: "updated" }]),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      const staleConflicts = result.conflicts.filter(
        (c) => c.type === CT.StaleLine && c.message.includes("版本过期")
      );
      expect(staleConflicts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════
  // decision_mismatch tests
  // ═══════════════════════════════════════════════
  describe("decision_mismatch detection", () => {
    it("should detect pass vs reject direction mismatch", () => {
      const input: DetectionInput = {
        draft: makeDraft({ suggestedDecision: "pass", humanDecision: "reject" }),
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      const mismatch = result.conflicts.find((c) => c.type === CT.DecisionMismatch);
      expect(mismatch).toBeDefined();
      expect(mismatch!.message).toContain("方向相反");
    });

    it("should detect reject vs pass direction mismatch", () => {
      const input: DetectionInput = {
        draft: makeDraft({ suggestedDecision: "reject", humanDecision: "pass" }),
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      const mismatch = result.conflicts.find((c) => c.type === CT.DecisionMismatch);
      expect(mismatch).toBeDefined();
    });

    it("should NOT flag pass→hold or hold→pass as mismatch", () => {
      const input: DetectionInput = {
        draft: makeDraft({ suggestedDecision: "hold", humanDecision: "pass" }),
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      const mismatch = result.conflicts.filter((c) => c.type === CT.DecisionMismatch);
      // pass vs hold is NOT significant (only pass vs reject is)
      expect(mismatch).toHaveLength(0);
    });

    it("should detect conflict with existing workspace markdown (old=reject, new=pass)", () => {
      const input: DetectionInput = {
        draft: makeDraft({ humanDecision: "pass", suggestedDecision: null }),
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: { interviewId: "int-1", revision: 1, generatedAt: "2026-01-01", lineCount: 10, evidenceCount: 3 },
        existingMarkdown: "面试结论：❌ 不通过\n综合建议：reject",
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      const mismatch = result.conflicts.filter((c) => c.type === CT.DecisionMismatch);
      expect(mismatch.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect conflict with existing workspace markdown (old=pass, new=reject)", () => {
      const input: DetectionInput = {
        draft: makeDraft({ humanDecision: "reject", suggestedDecision: null }),
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: { interviewId: "int-1", revision: 1, generatedAt: "2026-01-01", lineCount: 10, evidenceCount: 3 },
        existingMarkdown: "面试结论：✅ 通过\n决策：pass",
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      const mismatch = result.conflicts.filter((c) => c.type === CT.DecisionMismatch);
      expect(mismatch.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════
  // missing_field tests
  // ═══════════════════════════════════════════════
  describe("missing_field detection", () => {
    it("should detect missing humanDecision", () => {
      const input: DetectionInput = {
        draft: makeDraft({ humanDecision: null }),
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      const missing = result.conflicts.find(
        (c) => c.type === CT.MissingField && c.fieldPath === "humanDecision"
      );
      expect(missing).toBeDefined();
    });

    it("should detect missing overview", () => {
      const input: DetectionInput = {
        draft: makeDraft({ overview: "" }),
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      const missing = result.conflicts.find(
        (c) => c.type === CT.MissingField && c.fieldPath === "overview"
      );
      expect(missing).toBeDefined();
    });

    it("should detect empty conclusions array", () => {
      const draft = makeDraft({ conclusions: [] });
      const input: DetectionInput = {
        draft,
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      const missing = result.conflicts.find(
        (c) => c.type === CT.MissingField && c.fieldPath === "conclusions"
      );
      expect(missing).toBeDefined();
    });

    it("should detect conclusion with empty text", () => {
      const draft = makeDraft({
        conclusions: [
          { dimension: "技术深度", text: "", evidenceRefs: [] },
        ],
      });
      const input: DetectionInput = {
        draft,
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      const missing = result.conflicts.find(
        (c) => c.type === CT.MissingField && c.fieldPath.includes(".text")
      );
      expect(missing).toBeDefined();
    });

    it("should detect conclusion with empty dimension", () => {
      const draft = makeDraft({
        conclusions: [
          { dimension: "", text: "good", evidenceRefs: [] },
        ],
      });
      const input: DetectionInput = {
        draft,
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      const missing = result.conflicts.find(
        (c) => c.type === CT.MissingField && c.fieldPath.includes(".dimension")
      );
      expect(missing).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════
  // Combined conflicts
  // ═══════════════════════════════════════════════
  describe("combined conflicts", () => {
    it("should return multiple conflict types when many issues exist", () => {
      const draft = makeDraft({
        humanDecision: null,
        overview: "",
        conclusions: [],
      });
      const input: DetectionInput = {
        draft,
        transcriptLines: makeTranscriptLines(),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };
      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.length).toBeGreaterThanOrEqual(3);
      // Should have both decision mismatch AND missing field conflicts
      expect(result.conflictTypes).toContain(CT.MissingField);
    });
  });

  // ═══════════════════════════════════════════════
  // parseExistingSyncMeta
  // ═══════════════════════════════════════════════
  describe("parseExistingSyncMeta", () => {
    it("should parse valid sync.json", () => {
      const json = JSON.stringify({
        interviewId: "int-1",
        revision: 3,
        generatedAt: "2026-07-21T10:00:00Z",
        lineCount: 17,
        evidenceCount: 5,
      });
      const result = parseExistingSyncMeta(json);
      expect(result).not.toBeNull();
      expect(result!.interviewId).toBe("int-1");
      expect(result!.revision).toBe(3);
      expect(result!.lineCount).toBe(17);
    });

    it("should return null for invalid JSON", () => {
      expect(parseExistingSyncMeta("not json")).toBeNull();
    });

    it("should return null for missing required fields", () => {
      const json = JSON.stringify({ revision: 1 });
      expect(parseExistingSyncMeta(json)).toBeNull();
    });

    it("should handle missing optional fields", () => {
      const json = JSON.stringify({
        interviewId: "int-1",
        revision: 1,
        generatedAt: "2026-01-01",
      });
      const result = parseExistingSyncMeta(json);
      expect(result).not.toBeNull();
      expect(result!.lineCount).toBe(0);
      expect(result!.evidenceCount).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════
  // isAutoResolvable
  // ═══════════════════════════════════════════════
  describe("isAutoResolvable", () => {
    it("should return false for all conflict types", () => {
      const conflict = {
        type: CT.StaleLine,
        fieldPath: "conclusions.test.evidence[line-1]",
        localValue: { revision: 1 },
        remoteValue: { revision: 2 },
        message: "line stale",
      };
      expect(isAutoResolvable(conflict)).toBe(false);
    });
  });
});
