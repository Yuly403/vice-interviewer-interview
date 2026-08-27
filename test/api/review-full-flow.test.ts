import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vice/database";
import {
  transition,
  transitionReview,
  canTransition,
  canTransitionReview,
  validateReviewConclusion,
  generateInterviewArchive,
} from "@vice/domain";
import { ReviewStatus as RS, InterviewStatus as IS, HumanDecision as HD } from "@vice/contracts";

const INTERVIEW_ID = "int-test-review-full";

describe("API Integration: Review full flow", () => {
  beforeAll(async () => {
    // 1. Create interview
    await prisma.interview.upsert({
      where: { id: INTERVIEW_ID },
      create: {
        id: INTERVIEW_ID,
        applicationId: "app-review-test",
        roundType: "first_round",
        scheduledAt: new Date(),
        durationMinutes: 60,
        status: IS.Ended,
        packageRevision: 1,
      },
      update: { status: IS.Ended },
    });

    // 2. Create participants
    await prisma.interviewParticipant.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.interviewParticipant.createMany({
      data: [
        { interviewId: INTERVIEW_ID, userId: "u-review-1", displayName: "面试官A", role: "interviewer", roleSource: "user" },
        { interviewId: INTERVIEW_ID, displayName: "候选人D", role: "candidate", roleSource: "user" },
      ],
    });

    // 3. Create transcript lines (for evidence validation)
    await prisma.transcriptLine.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.transcriptLine.createMany({
      data: [
        { interviewId: INTERVIEW_ID, sourceType: "manual", platformSentenceId: "rev-s-1", speakerDisplayName: "候选人D", speakerRole: "candidate", roleSource: "user", text: "我对分布式系统有深入理解，主导过公司核心系统的微服务化改造。", occurredAt: new Date() },
        { interviewId: INTERVIEW_ID, sourceType: "manual", platformSentenceId: "rev-s-2", speakerDisplayName: "候选人D", speakerRole: "candidate", roleSource: "user", text: "在CAP理论中我选择了AP模型，因为我们的业务对一致性要求可以通过最终一致来满足。", occurredAt: new Date() },
        { interviewId: INTERVIEW_ID, sourceType: "manual", platformSentenceId: "rev-s-3", speakerDisplayName: "候选人D", speakerRole: "candidate", roleSource: "user", text: "我负责带领4人团队，采用Scrum方式管理项目进度。", occurredAt: new Date() },
      ],
    });

    // 4. Create plan with topics (for review generation context)
    await prisma.interviewPlan.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    const plan = await prisma.interviewPlan.create({
      data: {
        interviewId: INTERVIEW_ID,
        totalDurationMinutes: 60,
        openingBudgetMinutes: 5,
        closingBudgetMinutes: 5,
      },
    });

    await prisma.topic.createMany({
      data: [
        { planId: plan.id, title: "技术深度", why: "验证技术能力", openingQuestion: "介绍你的技术背景", priority: "high", estimatedMinutes: 15, sortOrder: 0 },
        { planId: plan.id, title: "系统设计", why: "评估架构能力", openingQuestion: "说说你的系统设计经验", priority: "high", estimatedMinutes: 15, sortOrder: 1 },
        { planId: plan.id, title: "团队协作", why: "评估软技能", openingQuestion: "如何管理团队？", priority: "medium", estimatedMinutes: 10, sortOrder: 2 },
      ],
    });
  });

  afterAll(async () => {
    // Cleanup cascade
    const drafts = await prisma.reviewDraft.findMany({ where: { interviewId: INTERVIEW_ID } });
    for (const d of drafts) {
      const conclusions = await prisma.reviewConclusion.findMany({ where: { reviewId: d.id } });
      for (const c of conclusions) {
        await prisma.evidenceRef.deleteMany({ where: { conclusionId: c.id } });
      }
      await prisma.reviewConclusion.deleteMany({ where: { reviewId: d.id } });
    }
    await prisma.reviewDraft.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.approval.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.auditEvent.deleteMany({ where: { interviewId: INTERVIEW_ID } });

    const plan = await prisma.interviewPlan.findUnique({ where: { interviewId: INTERVIEW_ID } });
    if (plan) {
      const topics = await prisma.topic.findMany({ where: { planId: plan.id } });
      for (const t of topics) {
        await prisma.criterion.deleteMany({ where: { topicId: t.id } });
        await prisma.followupQuestion.deleteMany({ where: { topicId: t.id } });
      }
      await prisma.topic.deleteMany({ where: { planId: plan.id } });
      await prisma.interviewPlan.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    }

    await prisma.transcriptLineRevision.deleteMany({ where: { line: { interviewId: INTERVIEW_ID } } });
    await prisma.transcriptLine.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.interviewParticipant.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.interview.deleteMany({ where: { id: INTERVIEW_ID } });
    await prisma.$disconnect();
  });

  // ══════════════════════════════════════
  // Stage 1: Generate review draft
  // ══════════════════════════════════════
  describe("Stage 1: Review generation (rule-based)", () => {
    it("should create review draft with conclusions and evidence refs", async () => {
      const transcriptLines = await prisma.transcriptLine.findMany({
        where: { interviewId: INTERVIEW_ID, isDeleted: false, speakerRole: "candidate" },
      });

      const draft = await prisma.reviewDraft.create({
        data: {
          interviewId: INTERVIEW_ID,
          revision: 1,
          reviewStatus: RS.DraftReady,
          overview: "候选人整体表现出色，技术功底扎实。",
          strengths: JSON.stringify(["技术能力强", "系统设计好"]),
          risks: JSON.stringify(["经验领域偏窄"]),
          suggestedDecision: HD.Pass,
        },
      });

      // Create conclusions with evidence refs
      const conc1 = await prisma.reviewConclusion.create({
        data: {
          reviewId: draft.id,
          dimension: "技术深度",
          text: "候选人对分布式系统有深入理解",
          contentType: "ai_generated",
          aiGenerated: true,
          sortOrder: 0,
        },
      });

      await prisma.evidenceRef.create({
        data: {
          conclusionId: conc1.id,
          sourceType: "transcript",
          sourceId: transcriptLines[0].id,
          sourceRevision: transcriptLines[0].revision,
          quote: transcriptLines[0].text.slice(0, 30),
        },
      });

      const conc2 = await prisma.reviewConclusion.create({
        data: {
          reviewId: draft.id,
          dimension: "系统设计",
          text: "候选人能清晰解释CAP理论和选型决策",
          contentType: "ai_generated",
          aiGenerated: true,
          sortOrder: 1,
        },
      });

      await prisma.evidenceRef.create({
        data: {
          conclusionId: conc2.id,
          sourceType: "transcript",
          sourceId: transcriptLines[1].id,
          sourceRevision: transcriptLines[1].revision,
          quote: transcriptLines[1].text.slice(0, 30),
        },
      });

      expect(draft).toBeDefined();
      expect(draft.revision).toBe(1);
      expect(draft.reviewStatus).toBe(RS.DraftReady);
    });

    it("should validate evidence refs against transcript", async () => {
      const transcriptLines = await prisma.transcriptLine.findMany({
        where: { interviewId: INTERVIEW_ID, isDeleted: false },
      });

      const draft = await prisma.reviewDraft.findFirst({
        where: { interviewId: INTERVIEW_ID },
        orderBy: { revision: "desc" },
        include: { conclusions: { include: { evidenceRefs: true } } },
      });

      // Validate each conclusion
      for (const conclusion of draft!.conclusions) {
        const result = validateReviewConclusion(conclusion as any, transcriptLines as any);
        expect(result.valid).toBe(true);
      }
    });

    it("should update interview status to review_draft", async () => {
      // Ended → TranscriptFinalizing → ReviewGenerating → ReviewDraft (correct chain)
      const t1 = transition(IS.Ended, IS.TranscriptFinalizing, { transcriptAvailable: true });
      expect(t1.ok).toBe(true);

      const t2 = transition(IS.TranscriptFinalizing, IS.ReviewGenerating, { structureValid: true });
      expect(t2.ok).toBe(true);

      const t3 = transition(IS.ReviewGenerating, IS.ReviewDraft, {
        transcriptAvailable: true,
        structureValid: true,
      });
      expect(t3.ok).toBe(true);

      if (t3.ok) {
        await prisma.interview.update({
          where: { id: INTERVIEW_ID },
          data: { status: t3.newStatus },
        });
      }

      const interview = await prisma.interview.findUnique({ where: { id: INTERVIEW_ID } });
      expect(interview!.status).toBe(IS.ReviewDraft);
    });
  });

  // ══════════════════════════════════════
  // Stage 2: Human edit review draft
  // ══════════════════════════════════════
  describe("Stage 2: Human review editing", () => {
    it("should allow editing review draft (add human decision)", async () => {
      const draft = await prisma.reviewDraft.findFirst({
        where: { interviewId: INTERVIEW_ID },
        orderBy: { revision: "desc" },
      });

      expect(draft).not.toBeNull();

      const updated = await prisma.reviewDraft.update({
        where: { id: draft!.id },
        data: {
          reviewStatus: RS.Editing,
          humanDecision: HD.Pass,
          strengths: JSON.stringify(["技术能力强", "系统设计好", "沟通表达优秀"]),
          revision: { increment: 1 },
        },
      });

      expect(updated.reviewStatus).toBe(RS.Editing);
      expect(updated.humanDecision).toBe(HD.Pass);

      const strengths = JSON.parse(updated.strengths || "[]");
      expect(strengths).toHaveLength(3);
    });
  });

  // ══════════════════════════════════════
  // Stage 3: Approve review
  // ══════════════════════════════════════
  describe("Stage 3: Review approval", () => {
    it("should approve review with full state transition", async () => {
      const draft = await prisma.reviewDraft.findFirst({
        where: { interviewId: INTERVIEW_ID },
        orderBy: { revision: "desc" },
      });

      // First: update review to ApprovalPending (Editing → ApprovalPending → Approved)
      await prisma.reviewDraft.update({
        where: { id: draft!.id },
        data: { reviewStatus: RS.ApprovalPending },
      });

      // Review-level state transition: ApprovalPending → Approved (with guards)
      const reviewTransition = transitionReview(
        RS.ApprovalPending,
        RS.Approved,
        {
          evidenceValidationPassed: true,
          strongIdentity: true,
          idempotencyKey: true,
        }
      );
      expect(reviewTransition.ok).toBe(true);

      // Interview-level state transition
      const interviewTransition = transition(IS.ReviewDraft, IS.ReviewApproved);
      expect(interviewTransition.ok).toBe(true);

      // Persist both
      await prisma.reviewDraft.update({
        where: { id: draft!.id },
        data: {
          reviewStatus: reviewTransition.ok ? reviewTransition.newStatus : RS.Approved,
          approvedBy: "面试官A",
          approvedAt: new Date(),
        },
      });

      await prisma.interview.update({
        where: { id: INTERVIEW_ID },
        data: {
          status: interviewTransition.ok ? interviewTransition.newStatus : IS.ReviewApproved,
          approvedReviewRevision: draft!.revision,
        },
      });

      // Verify
      const interview = await prisma.interview.findUnique({ where: { id: INTERVIEW_ID } });
      const updatedDraft = await prisma.reviewDraft.findUnique({ where: { id: draft!.id } });

      expect(interview!.status).toBe(IS.ReviewApproved);
      expect(updatedDraft!.reviewStatus).toBe(RS.Approved);
      expect(updatedDraft!.approvedBy).toBe("面试官A");
      expect(updatedDraft!.approvedAt).not.toBeNull();
    });

    it("should record approval in audit table", async () => {
      const draft = await prisma.reviewDraft.findFirst({
        where: { interviewId: INTERVIEW_ID },
        orderBy: { revision: "desc" },
      });

      await prisma.approval.create({
        data: {
          interviewId: INTERVIEW_ID,
          targetType: "review",
          targetId: draft!.id,
          targetRevision: draft!.revision,
          action: "approve",
          approvedBy: "面试官A",
          reason: "候选人技术能力优秀，建议进入下一轮",
          idempotencyKey: `test-approve-${INTERVIEW_ID}-${draft!.revision}`,
        },
      });

      const approval = await prisma.approval.findUnique({
        where: { idempotencyKey: `test-approve-${INTERVIEW_ID}-${draft!.revision}` },
      });

      expect(approval).not.toBeNull();
      expect(approval!.action).toBe("approve");
    });
  });

  // ══════════════════════════════════════
  // Stage 4: Export review result
  // ══════════════════════════════════════
  describe("Stage 4: Export review result", () => {
    it("should export approved review as structured package", async () => {
      const draft = await prisma.reviewDraft.findFirst({
        where: { interviewId: INTERVIEW_ID, approvedAt: { not: null } },
        orderBy: { revision: "desc" },
        include: { conclusions: { include: { evidenceRefs: true }, orderBy: { sortOrder: "asc" } } },
      });

      expect(draft).not.toBeNull();

      const resultPackage = {
        schemaVersion: "1.0",
        interviewId: INTERVIEW_ID,
        candidateKey: draft!.interviewId,
        jobKey: "demo-job",
        reviewStatus: "approved",
        approvedBy: draft!.approvedBy || "unknown",
        approvedAt: draft!.approvedAt?.toISOString(),
        dimensionReviews: draft!.conclusions.map((c) => ({
          dimension: c.dimension,
          summary: c.text,
        })),
        strengths: JSON.parse(draft!.strengths || "[]"),
        risks: JSON.parse(draft!.risks || "[]"),
        humanDecision: draft!.humanDecision || "hold",
        nextRoundFocus: JSON.parse(draft!.nextRoundFocus || "[]"),
        sourceRevision: draft!.revision,
      };

      expect(resultPackage.schemaVersion).toBe("1.0");
      expect(resultPackage.reviewStatus).toBe("approved");
      expect(resultPackage.strengths.length).toBeGreaterThan(0);
      expect(resultPackage.dimensionReviews.length).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════
  // Stage 5: Archive generation (SYNC-001)
  // ══════════════════════════════════════
  describe("Stage 5: Archive generation", () => {
    it("should generate structured markdown archive", async () => {
      const interview = await prisma.interview.findUnique({
        where: { id: INTERVIEW_ID },
        include: { participants: true },
      });

      const draft = await prisma.reviewDraft.findFirst({
        where: { interviewId: INTERVIEW_ID, approvedAt: { not: null } },
        orderBy: { revision: "desc" },
        include: { conclusions: { include: { evidenceRefs: true } } },
      });

      const transcriptCount = await prisma.transcriptLine.count({
        where: { interviewId: INTERVIEW_ID, isDeleted: false },
      });

      const archive = generateInterviewArchive({
        interviewId: INTERVIEW_ID,
        revision: draft!.revision,
        scheduledAt: interview!.scheduledAt.toISOString(),
        roundType: interview!.roundType,
        participants: interview!.participants.map((p) => ({
          displayName: p.displayName,
          role: p.role,
        })),
        overview: draft!.overview,
        strengths: JSON.parse(draft!.strengths || "[]"),
        risks: JSON.parse(draft!.risks || "[]"),
        openQuestions: JSON.parse(draft!.openQuestions || "[]"),
        uncoveredTopics: JSON.parse(draft!.uncoveredTopics || "[]"),
        nextRoundFocus: JSON.parse(draft!.nextRoundFocus || "[]"),
        suggestedDecision: draft!.suggestedDecision,
        humanDecision: draft!.humanDecision,
        approvedBy: draft!.approvedBy,
        approvedAt: draft!.approvedAt?.toISOString() || null,
        conclusions: draft!.conclusions.map((c) => ({
          dimension: c.dimension,
          contentType: c.contentType,
          text: c.text,
          aiGenerated: c.aiGenerated,
          humanEdited: c.humanEdited,
          evidenceRefs: c.evidenceRefs.map((e) => ({
            sourceType: e.sourceType,
            quote: e.quote,
            speakerRole: e.speakerRole,
            occurredAt: e.occurredAt?.toISOString() || null,
          })),
        })),
        topics: [],
        transcriptLineCount: transcriptCount,
      });

      // Verify markdown structure
      expect(archive.markdown).toBeDefined();
      expect(archive.markdown).toContain("初面面评档案");
      expect(archive.markdown).toContain("## 1. 面试概览");
      expect(archive.markdown).toContain("## 3. 综合概览");
      expect(archive.markdown).toContain("## 4. 分维度评价");
      expect(archive.markdown).toContain("## 7. 结论");
      expect(archive.markdown).toContain("技术深度");
      expect(archive.markdown).toContain("系统设计");

      // Verify sync metadata
      expect(archive.syncMeta).toBeDefined();
      expect(archive.syncMeta.generatedAt).toBeDefined();
      expect(archive.syncMeta.evidenceCount).toBeGreaterThan(0);
    });
  });
});
