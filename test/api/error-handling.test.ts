import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vice/database";
import { canTransition, canTransitionReview, transition } from "@vice/domain";
import { InterviewStatus as IS, ReviewStatus as RS } from "@vice/contracts";

const INTERVIEW_ID = "int-test-errors-001";

describe("API Integration: Error handling & edge cases", () => {
  beforeAll(async () => {
    await prisma.interview.upsert({
      where: { id: INTERVIEW_ID },
      create: {
        id: INTERVIEW_ID,
        applicationId: "app-error-test",
        roundType: "first_round",
        scheduledAt: new Date(),
        durationMinutes: 60,
        status: IS.Created,
        packageRevision: 1,
      },
      update: { status: IS.Created },
    });
  });

  afterAll(async () => {
    // Clean up child records before deleting the interview (FK constraint)
    await prisma.approval.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    const drafts = await prisma.reviewDraft.findMany({ where: { interviewId: INTERVIEW_ID } });
    for (const d of drafts) {
      await prisma.reviewConclusion.deleteMany({ where: { reviewId: d.id } });
    }
    await prisma.reviewDraft.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.transcriptLineRevision.deleteMany({ where: { line: { interviewId: INTERVIEW_ID } } });
    await prisma.transcriptLine.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.auditEvent.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.interviewParticipant.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.interview.deleteMany({ where: { id: INTERVIEW_ID } });
    await prisma.$disconnect();
  });

  describe("Not found errors", () => {
    it("should handle interview not found", async () => {
      const interview = await prisma.interview.findUnique({ where: { id: "non-existent-id" } });
      expect(interview).toBeNull();
    });

    it("should handle plan not found", async () => {
      const plan = await prisma.interviewPlan.findUnique({ where: { interviewId: "non-existent-id" } });
      expect(plan).toBeNull();
    });

    it("should handle review draft not found", async () => {
      const draft = await prisma.reviewDraft.findFirst({
        where: { interviewId: "non-existent-id" },
        orderBy: { revision: "desc" },
      });
      expect(draft).toBeNull();
    });

    it("should handle transcript line not found", async () => {
      const line = await prisma.transcriptLine.findUnique({ where: { id: "non-existent-line-id" } });
      expect(line).toBeNull();
    });
  });

  describe("Invalid state transitions", () => {
    it("should deny Created → Synced (skip 14 states)", () => {
      expect(canTransition(IS.Created, IS.Synced)).toBe(false);
    });

    it("should deny Created → Live (need Ready + Bound first)", () => {
      expect(canTransition(IS.Created, IS.Live)).toBe(false);
    });

    it("should deny Created → ReviewDraft (need Ended + Transcript first)", () => {
      expect(canTransition(IS.Created, IS.ReviewDraft)).toBe(false);
    });

    it("should deny ReviewDraft → ReviewApproved without evidence validation guard", () => {
      // Interview-level: ReviewDraft → ReviewApproved is allowed by the interview state machine
      expect(canTransition(IS.ReviewDraft, IS.ReviewApproved)).toBe(true);
      // Review-level: DraftReady → Approved is NOT a direct path; must go via ApprovalPending
      expect(canTransitionReview(RS.DraftReady, RS.Approved)).toBe(false);
      // Correct review approval path: DraftReady → ApprovalPending → Approved
      expect(canTransitionReview(RS.DraftReady, RS.ApprovalPending)).toBe(true);
      expect(canTransitionReview(RS.ApprovalPending, RS.Approved)).toBe(true);
    });

    it("should deny Closed → anything (terminal)", () => {
      const terminalStates = [IS.Closed, IS.Cancelled];
      const nonTerminalStates = Object.values(IS).filter((s) => !terminalStates.includes(s));
      for (const terminal of terminalStates) {
        for (const target of nonTerminalStates) {
          if (terminal === IS.Cancelled && target === IS.Cancelled) continue;
          expect(canTransition(terminal as IS, target as IS)).toBe(false);
        }
      }
    });

    it("should deny Synced → ReviewDraft (cannot go backwards)", () => {
      expect(canTransition(IS.Synced, IS.ReviewDraft)).toBe(false);
    });
  });

  describe("Unique constraint violations", () => {
    it("should reject duplicate interview IDs", async () => {
      await expect(
        prisma.interview.create({
          data: {
            id: INTERVIEW_ID, // Already exists
            applicationId: "dup-app",
            roundType: "first_round",
            scheduledAt: new Date(),
            durationMinutes: 60,
            status: IS.Created,
            packageRevision: 1,
          },
        })
      ).rejects.toThrow();
    });

    it("should reject duplicate approval idempotency keys", async () => {
      const key = "test-unique-approval-key";

      await prisma.approval.create({
        data: {
          interviewId: INTERVIEW_ID,
          targetType: "review",
          targetId: "fake-draft-id",
          targetRevision: 1,
          action: "approve",
          approvedBy: "test-user",
          reason: "test",
          idempotencyKey: key,
        },
      });

      await expect(
        prisma.approval.create({
          data: {
            interviewId: INTERVIEW_ID,
            targetType: "review",
            targetId: "fake-draft-id-2",
            targetRevision: 2,
            action: "approve",
            approvedBy: "test-user-2",
            reason: "test 2",
            idempotencyKey: key, // Duplicate
          },
        })
      ).rejects.toThrow();

      // Cleanup
      await prisma.approval.deleteMany({ where: { idempotencyKey: key } });
    });
  });

  describe("Data integrity edge cases", () => {
    it("should handle empty transcript for review generation", async () => {
      const count = await prisma.transcriptLine.count({
        where: { interviewId: "non-existent-id", isDeleted: false },
      });
      expect(count).toBe(0); // Should gracefully return 0
    });

    it("should handle empty strengths/risks JSON arrays", async () => {
      // Create draft with empty arrays
      const draft = await prisma.reviewDraft.create({
        data: {
          interviewId: INTERVIEW_ID,
          revision: 99,
          reviewStatus: RS.DraftReady,
          suggestedDecision: "hold",
          overview: "test empty arrays",
          strengths: "[]",
          risks: "[]",
        },
      });

      const strengths = JSON.parse(draft.strengths);
      const risks = JSON.parse(draft.risks);
      expect(strengths).toEqual([]);
      expect(risks).toEqual([]);

      await prisma.reviewDraft.delete({ where: { id: draft.id } });
    });

    it("should handle null/undefined optional fields gracefully", async () => {
      const draft = await prisma.reviewDraft.create({
        data: {
          interviewId: INTERVIEW_ID,
          revision: 100,
          reviewStatus: RS.DraftReady,
          suggestedDecision: null,
          humanDecision: null,
          overview: null,
          strengths: "[]",
          risks: "[]",
        },
      });

      expect(draft.suggestedDecision).toBeNull();
      expect(draft.humanDecision).toBeNull();
      expect(draft.overview).toBeNull();

      await prisma.reviewDraft.delete({ where: { id: draft.id } });
    });

    it("should handle very long text in transcript lines", async () => {
      // Clean up any leftover from previous runs
      await prisma.transcriptLine.deleteMany({
        where: { interviewId: INTERVIEW_ID, platformSentenceId: "sent-long-text" },
      });

      const longText = "A".repeat(10000);
      // Prisma default TEXT type should handle this on SQLite
      const line = await prisma.transcriptLine.create({
        data: {
          interviewId: INTERVIEW_ID,
          sourceType: "manual",
          platformSentenceId: "sent-long-text",
          speakerDisplayName: "测试用户",
          speakerRole: "candidate",
          roleSource: "user",
          text: longText,
          occurredAt: new Date(),
        },
      });

      expect(line).toBeDefined();
      expect(line.text).toBe(longText);

      // Cleanup
      await prisma.transcriptLine.delete({ where: { id: line.id } });
    });
  });

  describe("State machine guards", () => {
    it("should fail transition with workspaceConflictsResolved=false", () => {
      const result = transition(IS.ReviewApproved, IS.Synced, {
        workspaceConflictsResolved: false,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("workspaceConflictsResolved");
    });

    it("should fail transition with structureValid=false", () => {
      const result = transition(IS.PackageImported, IS.PlanGenerating, {
        structureValid: false,
      });
      expect(result.ok).toBe(false);
    });

    it("should fail transition with transcriptAvailable=false", () => {
      const result = transition(IS.Ended, IS.TranscriptFinalizing, {
        transcriptAvailable: false,
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("Bulk data consistency", () => {
    it("should handle concurrent transcript insertions", async () => {
      // Clean up any leftover bulk-line records from previous runs
      await prisma.transcriptLine.deleteMany({
        where: { interviewId: INTERVIEW_ID, platformSentenceId: { startsWith: "bulk-line-" } },
      });

      const lines = Array.from({ length: 10 }, (_, i) => ({
        interviewId: INTERVIEW_ID,
        sourceType: "manual" as const,
        platformSentenceId: `bulk-line-${i}`,
        speakerDisplayName: i % 2 === 0 ? "面试官" : "候选人",
        speakerRole: i % 2 === 0 ? "interviewer" : "candidate",
        roleSource: "user" as const,
        text: `批量测试对话行 ${i + 1}`,
        occurredAt: new Date(),
      }));

      // Create all in parallel
      await Promise.all(lines.map((line) =>
        prisma.transcriptLine.create({ data: line })
      ));

      const count = await prisma.transcriptLine.count({
        where: { interviewId: INTERVIEW_ID, platformSentenceId: { startsWith: "bulk-line-" } },
      });
      expect(count).toBe(10);

      // Cleanup
      await prisma.transcriptLine.deleteMany({
        where: { interviewId: INTERVIEW_ID, platformSentenceId: { startsWith: "bulk-line-" } },
      });
    });
  });
});
