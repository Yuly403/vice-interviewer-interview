import { describe, it, expect } from "vitest";
import {
  validateEvidenceRefs,
  validateReviewConclusion,
  computeDedupKey,
  shouldUpsert,
  computeTopicCoverage,
  ReminderBudget,
} from "@vice/domain";
import { SpeakerRole, ContentType } from "@vice/contracts";
import type { EvidenceRef, TranscriptLine, ReviewConclusion } from "@vice/contracts";

function makeLine(overrides: Partial<TranscriptLine> = {}): TranscriptLine {
  return {
    id: "line-1",
    interviewId: "int-1",
    speakerRole: SpeakerRole.Candidate,
    speakerDisplayName: "候选人",
    text: "这是逐字稿文本内容",
    occurredAt: "2026-07-21T10:00:00Z",
    isDeleted: false,
    sourceRevision: 1,
    ...overrides,
  } as TranscriptLine;
}

function makeRef(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    sourceType: "transcript",
    sourceId: "line-1",
    sourceRevision: 1,
    quote: "逐字稿文本",
    ...overrides,
  };
}

describe("validation", () => {
  // ─── validateEvidenceRefs ───
  describe("validateEvidenceRefs", () => {
    it("should pass with valid refs", () => {
      const result = validateEvidenceRefs([makeRef()], [makeLine()]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail with missing sourceId", () => {
      const result = validateEvidenceRefs(
        [makeRef({ sourceId: "" })],
        [makeLine()]
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("MISSING_SOURCE_ID");
    });

    it("should fail with non-existent line", () => {
      const result = validateEvidenceRefs(
        [makeRef({ sourceId: "line-missing" })],
        [makeLine()]
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("SOURCE_NOT_FOUND");
    });

    it("should fail with deleted line", () => {
      const result = validateEvidenceRefs(
        [makeRef()],
        [makeLine({ isDeleted: true })]
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("SOURCE_DELETED");
    });

    it("should fail with quote mismatch", () => {
      const result = validateEvidenceRefs(
        [makeRef({ quote: "不存在的引用" })],
        [makeLine()]
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("QUOTE_MISMATCH");
    });

    it("should fail with role mismatch", () => {
      const result = validateEvidenceRefs(
        [makeRef()],
        [makeLine()],
        SpeakerRole.Interviewer
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("ROLE_MISMATCH");
    });

    it("should skip role check when allowedRole is Unknown", () => {
      const result = validateEvidenceRefs(
        [makeRef()],
        [makeLine({ speakerRole: SpeakerRole.Interviewer })],
        SpeakerRole.Unknown
      );
      expect(result.valid).toBe(true);
    });
  });

  // ─── validateReviewConclusion ───
  describe("validateReviewConclusion", () => {
    const baseConclusion: ReviewConclusion = {
      id: "rc-1",
      draftId: "draft-1",
      dimension: "技术深度",
      text: "对技术理解深",
      contentType: ContentType.AIGenerated,
      sortOrder: 0,
      evidenceRefs: [makeRef()],
    };

    it("should pass for valid AI-generated conclusion", () => {
      const result = validateReviewConclusion(baseConclusion, [makeLine()]);
      expect(result.valid).toBe(true);
    });

    it("should reject a conclusion supported only by an interviewer line", () => {
      const result = validateReviewConclusion(
        { ...baseConclusion, contentType: ContentType.Fact },
        [makeLine({ speakerRole: SpeakerRole.Interviewer })],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("ROLE_MISMATCH");
    });

    it("should reject non-transcript evidence for an AI conclusion", () => {
      const result = validateReviewConclusion(
        {
          ...baseConclusion,
          contentType: ContentType.Fact,
          evidenceRefs: [{
            sourceType: "resume",
            sourceId: "resume-1",
            sourceRevision: 1,
            quote: "候选人简历原文",
          }],
        },
        [makeLine()],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("UNSUPPORTED_EVIDENCE_SOURCE");
    });

    it("should skip validation for HumanDecision content type", () => {
      const result = validateReviewConclusion(
        { ...baseConclusion, contentType: ContentType.HumanDecision, evidenceRefs: [] },
        []
      );
      expect(result.valid).toBe(true);
    });

    it("should fail when evidenceRefs is empty for AI content", () => {
      const result = validateReviewConclusion(
        { ...baseConclusion, evidenceRefs: [] },
        []
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("NO_EVIDENCE");
    });
  });

  // ─── computeDedupKey ───
  describe("computeDedupKey", () => {
    it("should normalize whitespace", () => {
      const key1 = computeDedupKey({
        speakerDisplayName: "张三",
        text: "hello world",
        occurredAt: "2026-01-01",
      });
      const key2 = computeDedupKey({
        speakerDisplayName: "张三",
        text: "hello   world",
        occurredAt: "2026-01-01",
      });
      expect(key1).toBe(key2);
    });

    it("should be case-insensitive", () => {
      const key1 = computeDedupKey({
        speakerDisplayName: "张三",
        text: "Hello World",
        occurredAt: "2026-01-01",
      });
      const key2 = computeDedupKey({
        speakerDisplayName: "张三",
        text: "hello world",
        occurredAt: "2026-01-01",
      });
      expect(key1).toBe(key2);
    });
  });

  // ─── shouldUpsert ───
  describe("shouldUpsert", () => {
    it("should return upsert for new line", () => {
      const result = shouldUpsert(undefined, makeLine());
      expect(result.action).toBe("upsert");
      expect(result.reason).toBe("new");
    });

    it("should return skip for deleted line", () => {
      const result = shouldUpsert(
        makeLine({ isDeleted: true }),
        makeLine()
      );
      expect(result.action).toBe("skip");
      expect(result.reason).toBe("deleted");
    });

    it("should return upsert when text expanded", () => {
      const result = shouldUpsert(
        makeLine({ text: "short" }),
        makeLine({ text: "longer text here" })
      );
      expect(result.action).toBe("upsert");
      expect(result.reason).toBe("text_expanded");
    });

    it("should return upsert when text corrected", () => {
      const result = shouldUpsert(
        makeLine({ text: "helo" }),
        makeLine({ text: "helo" }) // same length, different text
      );
      // same text → skip
      expect(result.action).toBe("skip");
    });

    it("should return upsert when text corrected (same length, different)", () => {
      const result = shouldUpsert(
        makeLine({ text: "helo" }),
        makeLine({ text: "halo" })
      );
      expect(result.action).toBe("upsert");
      expect(result.reason).toBe("text_corrected");
    });

    it("should return skip when unchanged", () => {
      const result = shouldUpsert(
        makeLine({ text: "same text" }),
        makeLine({ text: "same text" })
      );
      expect(result.action).toBe("skip");
      expect(result.reason).toBe("unchanged");
    });
  });

  // ─── computeTopicCoverage ───
  describe("computeTopicCoverage", () => {
    it("should return 0% for empty criteria", () => {
      const result = computeTopicCoverage(
        { criteria: [] }
      );
      expect(result.coveragePercent).toBe(0);
      expect(result.isCovered).toBe(false);
      expect(result.hasGaps).toBe(true);
    });

    it("should compute correct coverage percentage", () => {
      const result = computeTopicCoverage(
        {
          criteria: [
            { status: "supported", evidenceLineIds: ["1"] },
            { status: "supported", evidenceLineIds: ["2"] },
            { status: "unsupported", evidenceLineIds: [] },
            { status: "unsupported", evidenceLineIds: [] },
          ],
        }
      );
      expect(result.coveragePercent).toBe(50);
      expect(result.isCovered).toBe(false);
      expect(result.hasGaps).toBe(true);
    });

    it("should report fully covered", () => {
      const result = computeTopicCoverage(
        {
          criteria: [
            { status: "supported", evidenceLineIds: ["1"] },
            { status: "supported", evidenceLineIds: ["2"] },
          ],
        }
      );
      expect(result.coveragePercent).toBe(100);
      expect(result.isCovered).toBe(true);
      expect(result.hasGaps).toBe(false);
    });
  });

  // ─── ReminderBudget ───
  describe("ReminderBudget", () => {
    it("should allow reminders within budget", () => {
      const budget = new ReminderBudget(3, 1000);
      expect(budget.canRemind("topic-1")).toBe(true);
      budget.consume("topic-1");
      expect(budget.canRemind("topic-2")).toBe(true);
      budget.consume("topic-2");
      expect(budget.canRemind("topic-3")).toBe(true);
      budget.consume("topic-3");
      expect(budget.canRemind("topic-4")).toBe(false);
    });

    it("should enforce cooldown per topic", () => {
      const now = Date.now();
      const budget = new ReminderBudget(5, 5000);
      budget.consume("topic-1", now);
      expect(budget.canRemind("topic-1", now + 1000)).toBe(false);
      expect(budget.canRemind("topic-1", now + 6000)).toBe(true);
    });

    it("should track remaining count", () => {
      const budget = new ReminderBudget(3);
      expect(budget.remaining()).toBe(3);
      budget.consume("a");
      expect(budget.remaining()).toBe(2);
      budget.consume("b");
      expect(budget.remaining()).toBe(1);
    });

    it("should reset correctly", () => {
      const budget = new ReminderBudget(3);
      budget.consume("a");
      budget.consume("b");
      budget.reset();
      expect(budget.remaining()).toBe(3);
      expect(budget.canRemind("a")).toBe(true);
    });
  });
});
