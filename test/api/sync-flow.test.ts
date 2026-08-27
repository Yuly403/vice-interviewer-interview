import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vice/database";
import {
  detectSyncConflicts,
  canTransitionReview,
  transitionReview,
} from "@vice/domain";
import type { DetectionInput, DetectionDraft } from "@vice/domain";
import { ReviewStatus as RS, InterviewStatus as IS, HumanDecision as HD } from "@vice/contracts";

const INTERVIEW_ID = "int-test-sync-001";

// ─── Setup / Teardown ───

async function seedApprovedReview() {
  // 1. Create interview in review_approved state
  await prisma.interview.upsert({
    where: { id: INTERVIEW_ID },
    create: {
      id: INTERVIEW_ID,
      applicationId: "app-test-001",
      roundType: "first_round",
      scheduledAt: new Date(),
      durationMinutes: 60,
      status: IS.ReviewApproved,
      packageRevision: 1,
    },
    update: { status: IS.ReviewApproved },
  });

  // 2. Create participants
  await prisma.interviewParticipant.deleteMany({ where: { interviewId: INTERVIEW_ID } });
  await prisma.interviewParticipant.createMany({
    data: [
      { interviewId: INTERVIEW_ID, userId: "u-1", displayName: "面试官A", role: "interviewer", roleSource: "user" },
      { interviewId: INTERVIEW_ID, displayName: "候选人B", role: "candidate", roleSource: "user" },
    ],
  });

  // 3. Create transcript lines
  await prisma.transcriptLine.deleteMany({ where: { interviewId: INTERVIEW_ID } });
  await prisma.transcriptLine.createMany({
    data: [
      { interviewId: INTERVIEW_ID, sourceType: "manual", platformSentenceId: "s-1", speakerDisplayName: "候选人B", speakerRole: "candidate", roleSource: "user", text: "CAP理论的核心是取舍，不能同时满足三者", occurredAt: new Date() },
      { interviewId: INTERVIEW_ID, sourceType: "manual", platformSentenceId: "s-2", speakerDisplayName: "候选人B", speakerRole: "candidate", roleSource: "user", text: "在实际项目中我们选择了AP模型", occurredAt: new Date() },
      { interviewId: INTERVIEW_ID, sourceType: "manual", platformSentenceId: "s-3", speakerDisplayName: "候选人B", speakerRole: "candidate", roleSource: "user", text: "我会主动同步信息给团队成员", occurredAt: new Date() },
    ],
  });

  // 4. Create approved review draft
  await prisma.reviewDraft.deleteMany({ where: { interviewId: INTERVIEW_ID } });
  const draft = await prisma.reviewDraft.create({
    data: {
      interviewId: INTERVIEW_ID,
      revision: 1,
      reviewStatus: RS.Approved,
      suggestedDecision: HD.Pass,
      humanDecision: HD.Pass,
      overview: "候选人整体表现出色，技术功底扎实。",
      strengths: JSON.stringify(["技术能力强"]),
      risks: JSON.stringify(["经验偏窄"]),
      approvedAt: new Date(),
      approvedBy: "u-1",
    },
  });

  // 5. Create transcript lines for evidence linking
  const lines = await prisma.transcriptLine.findMany({ where: { interviewId: INTERVIEW_ID } });

  // 6. Create review conclusion with evidence refs
  const conclusion = await prisma.reviewConclusion.create({
    data: {
      review: { connect: { id: draft.id } },
      dimension: "技术深度",
      text: "对分布式系统理解深入",
      contentType: "ai_generated",
      sortOrder: 0,
    },
  });

  for (const line of lines.slice(0, 2)) {
    await prisma.evidenceRef.create({
      data: {
        conclusion: { connect: { id: conclusion.id } },
        sourceType: "transcript",
        sourceId: line.id,
        sourceRevision: line.revision,
        quote: line.text.slice(0, 20),
      },
    });
  }

  return { draft, lines, conclusion };
}

// ─── Tests ───

describe("API Integration: Sync flow", () => {
  beforeAll(async () => {
    await seedApprovedReview();
  });

  afterAll(async () => {
    // Cleanup in correct order (children first)
    await prisma.evidenceRef.deleteMany({ where: { conclusion: { review: { interviewId: INTERVIEW_ID } } } });
    await prisma.reviewConclusion.deleteMany({ where: { review: { interviewId: INTERVIEW_ID } } });
    await prisma.reviewDraft.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.transcriptLine.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.interviewParticipant.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.interview.deleteMany({ where: { id: INTERVIEW_ID } });
    await prisma.$disconnect();
  });

  // ═══════════════════════════════════════════════
  // Happy path: no conflicts
  // ═══════════════════════════════════════════════
  describe("sync — happy path", () => {
    it("should detect no conflicts for a valid approved review", async () => {
      const draft = await prisma.reviewDraft.findFirst({
        where: { interviewId: INTERVIEW_ID, approvedAt: { not: null } },
        orderBy: { revision: "desc" },
        include: { conclusions: { include: { evidenceRefs: true } } },
      });

      expect(draft).not.toBeNull();
      expect(draft!.reviewStatus).toBe(RS.Approved);

      const transcriptLines = await prisma.transcriptLine.findMany({
        where: { interviewId: INTERVIEW_ID, isDeleted: false },
      });

      const input: DetectionInput = {
        draft: {
          revision: draft!.revision,
          suggestedDecision: draft!.suggestedDecision,
          humanDecision: draft!.humanDecision,
          overview: draft!.overview,
          strengths: JSON.parse(draft!.strengths || "[]"),
          risks: JSON.parse(draft!.risks || "[]"),
          conclusions: draft!.conclusions.map((c) => ({
            dimension: c.dimension,
            text: c.text,
            evidenceRefs: c.evidenceRefs.map((e) => ({
              sourceId: e.sourceId,
              sourceRevision: e.sourceRevision,
              quote: e.quote,
            })),
          })),
        },
        transcriptLines: transcriptLines.map((l) => ({
          id: l.id,
          revision: l.revision,
          isDeleted: l.isDeleted,
          text: l.text,
        })),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };

      const result = detectSyncConflicts(input);
      if (result.hasConflicts) {
        console.log("Conflicts found:", JSON.stringify(result.conflicts, null, 2));
      }
      expect(result.hasConflicts).toBe(false);
    });

    it("should allow state transition from approved → sync_pending", () => {
      expect(canTransitionReview(RS.Approved, RS.SyncPending)).toBe(true);
      const result = transitionReview(RS.Approved, RS.SyncPending);
      expect(result.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // Conflict: missing humanDecision
  // ═══════════════════════════════════════════════
  describe("sync — missing humanDecision", () => {
    it("should detect missing humanDecision conflict", async () => {
      // Create a draft without human decision
      const draft = await prisma.reviewDraft.create({
        data: {
          interviewId: INTERVIEW_ID,
          revision: 5,
          reviewStatus: RS.DraftReady,
          suggestedDecision: HD.Pass,
          humanDecision: null, // Missing!
          overview: "整体表现良好",
          strengths: JSON.stringify(["技术好"]),
          risks: JSON.stringify([]),
        },
      });

      const transcriptLines = await prisma.transcriptLine.findMany({
        where: { interviewId: INTERVIEW_ID, isDeleted: false },
      });

      const input: DetectionInput = {
        draft: {
          revision: draft.revision,
          suggestedDecision: draft.suggestedDecision,
          humanDecision: draft.humanDecision,
          overview: draft.overview,
          strengths: JSON.parse(draft.strengths || "[]"),
          risks: JSON.parse(draft.risks || "[]"),
          conclusions: [],
        },
        transcriptLines: transcriptLines.map((l) => ({
          id: l.id, revision: l.revision, isDeleted: l.isDeleted, text: l.text,
        })),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };

      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);
      const humanDecisionConflict = result.conflicts.find(
        (c) => c.fieldPath === "humanDecision"
      );
      expect(humanDecisionConflict).toBeDefined();
      expect(humanDecisionConflict!.message).toContain("缺少人工最终决策");

      // Cleanup
      await prisma.reviewDraft.delete({ where: { id: draft.id } });
    });
  });

  // ═══════════════════════════════════════════════
  // Conflict: decision_mismatch (pass vs reject)
  // ═══════════════════════════════════════════════
  describe("sync — decision mismatch", () => {
    it("should detect significant decision mismatch", async () => {
      // Create a draft where AI says pass but human says reject
      const mismatchDraft = await prisma.reviewDraft.create({
        data: {
          interviewId: INTERVIEW_ID,
          revision: 6,
          reviewStatus: RS.DraftReady,
          suggestedDecision: HD.Pass,
          humanDecision: HD.Reject,
          overview: "有顾虑",
          strengths: JSON.stringify([]),
          risks: JSON.stringify(["经验不足"]),
        },
      });

      const transcriptLines = await prisma.transcriptLine.findMany({
        where: { interviewId: INTERVIEW_ID, isDeleted: false },
      });

      const input: DetectionInput = {
        draft: {
          revision: mismatchDraft.revision,
          suggestedDecision: mismatchDraft.suggestedDecision,
          humanDecision: mismatchDraft.humanDecision,
          overview: mismatchDraft.overview,
          strengths: JSON.parse(mismatchDraft.strengths || "[]"),
          risks: JSON.parse(mismatchDraft.risks || "[]"),
          conclusions: [],
        },
        transcriptLines: transcriptLines.map((l) => ({
          id: l.id, revision: l.revision, isDeleted: l.isDeleted, text: l.text,
        })),
        existingSyncMeta: null,
        existingMarkdown: null,
        isFinalRound: false,
      };

      const result = detectSyncConflicts(input);
      expect(result.hasConflicts).toBe(true);

      const mismatchConflicts = result.conflicts.filter(
        (c) => c.type === "decision_mismatch"
      );
      expect(mismatchConflicts.length).toBeGreaterThanOrEqual(1);
      expect(mismatchConflicts[0].message).toContain("方向相反");

      // Cleanup
      await prisma.reviewDraft.delete({ where: { id: mismatchDraft.id } });
    });
  });

  // ═══════════════════════════════════════════════
  // State machine: sync_conflict → resolve → sync_pending → synced
  // ═══════════════════════════════════════════════
  describe("sync conflict lifecycle", () => {
    it("should follow full conflict lifecycle: sync_conflict → resolve → sync_pending → synced", () => {
      // Step 1: SyncConflict state
      expect(canTransitionReview(RS.SyncConflict, RS.SyncPending)).toBe(true);

      // Step 2: Set back to sync_pending (retry)
      const t1 = transitionReview(RS.SyncConflict, RS.SyncPending);
      expect(t1.ok).toBe(true);
      if (!t1.ok) return;
      expect(t1.newStatus).toBe(RS.SyncPending);

      // Step 3: Now sync successfully (SyncPending → Synced)
      expect(canTransitionReview(RS.SyncPending, RS.Synced)).toBe(true);
      const t2 = transitionReview(t1.newStatus, RS.Synced);
      expect(t2.ok).toBe(true);
      if (t2.ok) expect(t2.newStatus).toBe(RS.Synced);

      // Step 4: Synced is terminal
      expect(canTransitionReview(RS.Synced, RS.SyncConflict)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════
  // Write syncConflicts to DB
  // ═══════════════════════════════════════════════
  describe("syncConflicts DB field", () => {
    it("should store and clear syncConflicts on draft", async () => {
      // Create a draft with sync_conflict state
      const draft = await prisma.reviewDraft.create({
        data: {
          interviewId: INTERVIEW_ID,
          revision: 10,
          reviewStatus: RS.SyncConflict,
          suggestedDecision: HD.Pass,
          humanDecision: HD.Pass,
          overview: "test",
          strengths: JSON.stringify([]),
          risks: JSON.stringify([]),
          syncConflicts: JSON.stringify([
            { type: "stale_line", fieldPath: "conclusions.test", message: "test conflict" },
          ]),
        },
      });

      // Verify conflict stored
      const loaded = await prisma.reviewDraft.findUnique({ where: { id: draft.id } });
      expect(loaded!.syncConflicts).not.toBeNull();
      const conflicts = JSON.parse(loaded!.syncConflicts!);
      expect(conflicts).toHaveLength(1);

      // Resolve: clear conflicts, mark resolved, set to sync_pending
      await prisma.reviewDraft.update({
        where: { id: draft.id },
        data: {
          reviewStatus: RS.SyncPending,
          syncConflicts: null,
          syncConflictsResolvedAt: new Date(),
        },
      });

      const resolved = await prisma.reviewDraft.findUnique({ where: { id: draft.id } });
      expect(resolved!.reviewStatus).toBe(RS.SyncPending);
      expect(resolved!.syncConflicts).toBeNull();
      expect(resolved!.syncConflictsResolvedAt).not.toBeNull();

      // Cleanup
      await prisma.reviewDraft.delete({ where: { id: draft.id } });
    });
  });
});
