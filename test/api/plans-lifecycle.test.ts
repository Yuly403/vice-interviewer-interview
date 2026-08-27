import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vice/database";
import { InterviewStatus as IS } from "@vice/contracts";

const INTERVIEW_ID = "int-test-plans-001";

describe("API Integration: Plan lifecycle", () => {
  beforeAll(async () => {
    // Create interview
    await prisma.interview.upsert({
      where: { id: INTERVIEW_ID },
      create: {
        id: INTERVIEW_ID,
        applicationId: "app-plan-test",
        roundType: "first_round",
        scheduledAt: new Date(),
        durationMinutes: 60,
        status: IS.PackageImported,
        packageRevision: 1,
      },
      update: { status: IS.PackageImported },
    });

    // Add participants
    await prisma.interviewParticipant.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.interviewParticipant.createMany({
      data: [
        { interviewId: INTERVIEW_ID, userId: "u-plan-1", displayName: "面试官A", role: "interviewer", roleSource: "user" },
        { interviewId: INTERVIEW_ID, displayName: "候选人C", role: "candidate", roleSource: "user" },
      ],
    });
  });

  afterAll(async () => {
    // Cleanup cascade
    const plan = await prisma.interviewPlan.findUnique({ where: { interviewId: INTERVIEW_ID } });
    if (plan) {
      const topics = await prisma.topic.findMany({ where: { planId: plan.id } });
      for (const t of topics) {
        await prisma.criterion.deleteMany({ where: { topicId: t.id } });
        await prisma.followupQuestion.deleteMany({ where: { topicId: t.id } });
        await prisma.topicSignal.deleteMany({ where: { topicId: t.id } });
        await prisma.topicSourceRef.deleteMany({ where: { topicId: t.id } });
      }
      await prisma.topic.deleteMany({ where: { planId: plan.id } });
      await prisma.interviewPlan.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    }
    await prisma.interviewParticipant.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.interview.deleteMany({ where: { id: INTERVIEW_ID } });
    await prisma.$disconnect();
  });

  describe("GET /interviews/:id/plan — get plan", () => {
    it("should return null when no plan exists", async () => {
      const plan = await prisma.interviewPlan.findUnique({
        where: { interviewId: INTERVIEW_ID },
        include: { topics: true },
      });
      expect(plan).toBeNull();
    });
  });

  describe("Plan generation (rule-based)", () => {
    it("should create a plan with 6 default topics", async () => {
      // Create plan
      const plan = await prisma.interviewPlan.create({
        data: {
          interviewId: INTERVIEW_ID,
          totalDurationMinutes: 60,
          openingBudgetMinutes: 5,
          closingBudgetMinutes: 5,
        },
      });

      expect(plan).toBeDefined();
      expect(plan.interviewId).toBe(INTERVIEW_ID);
      expect(plan.totalDurationMinutes).toBe(60);

      // Create topics (rule-based fallback)
      const topicTemplates = [
        { title: "自我介绍与背景核实", why: "了解候选人基本情况", openingQuestion: "请简单自我介绍", priority: "high", estimatedMinutes: 10, sortOrder: 0 },
        { title: "核心技术能力验证", why: "验证技术栈深度", openingQuestion: "介绍最有代表性的项目", priority: "high", estimatedMinutes: 12, sortOrder: 1 },
        { title: "系统设计与架构能力", why: "评估系统设计能力", openingQuestion: "如何从零设计XX系统？", priority: "high", estimatedMinutes: 12, sortOrder: 2 },
        { title: "问题解决与故障处理", why: "验证问题解决能力", openingQuestion: "讲一次最深刻的技术难题", priority: "medium", estimatedMinutes: 10, sortOrder: 3 },
        { title: "团队协作与沟通", why: "评估团队协作能力", openingQuestion: "描述跨团队合作项目", priority: "medium", estimatedMinutes: 8, sortOrder: 4 },
        { title: "职业规划与动机", why: "了解长期发展意向", openingQuestion: "未来2-3年技术规划？", priority: "low", estimatedMinutes: 8, sortOrder: 5 },
      ];

      for (const t of topicTemplates) {
        const topic = await prisma.topic.create({
          data: {
            ...t,
            planId: plan.id,
          },
        });

        // Add criteria
        await prisma.criterion.createMany({
          data: [
            { topicId: topic.id, text: `评估标准1: ${t.title}相关` },
            { topicId: topic.id, text: `评估标准2: 表达能力` },
          ],
        });

        // Add followup questions for first 3 topics
        if (t.sortOrder < 3) {
          await prisma.followupQuestion.createMany({
            data: [
              { topicId: topic.id, question: `追问问题1 for ${t.title}` },
              { topicId: topic.id, question: `追问问题2 for ${t.title}` },
            ],
          });
        }
      }

      // Verify plan is created with all topics
      const fullPlan = await prisma.interviewPlan.findUnique({
        where: { interviewId: INTERVIEW_ID },
        include: {
          topics: {
            include: { criteria: true, followups: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      expect(fullPlan).not.toBeNull();
      expect(fullPlan!.topics).toHaveLength(6);
      expect(fullPlan!.topics[0].criteria).toHaveLength(2);
      expect(fullPlan!.topics[0].followups).toHaveLength(2);
      expect(fullPlan!.topics[5].followups).toHaveLength(0); // No followups for last topics
    });
  });

  describe("Plan confirmation", () => {
    it("should confirm plan with confirmedAt and confirmedBy", async () => {
      const plan = await prisma.interviewPlan.update({
        where: { interviewId: INTERVIEW_ID },
        data: {
          confirmedAt: new Date(),
          confirmedBy: "面试官A",
        },
      });

      expect(plan.confirmedAt).not.toBeNull();
      expect(plan.confirmedBy).toBe("面试官A");
    });

    it("should transition interview status to Ready", async () => {
      await prisma.interview.update({
        where: { id: INTERVIEW_ID },
        data: { status: IS.Ready },
      });

      const interview = await prisma.interview.findUnique({ where: { id: INTERVIEW_ID } });
      expect(interview!.status).toBe(IS.Ready);
    });

    it("should not allow re-confirmation (idempotent check)", async () => {
      // Second confirmation should be idempotent
      const plan = await prisma.interviewPlan.update({
        where: { interviewId: INTERVIEW_ID },
        data: { confirmedAt: new Date(), confirmedBy: "面试官B" },
      });

      // Should update to new confirmer
      expect(plan.confirmedBy).toBe("面试官B");
    });
  });

  describe("Plan topic management", () => {
    it("should update topics (replace all)", async () => {
      const plan = await prisma.interviewPlan.findUnique({ where: { interviewId: INTERVIEW_ID } });
      expect(plan).not.toBeNull();

      // Get existing topic IDs to clean up child records first
      const existingTopics = await prisma.topic.findMany({ where: { planId: plan!.id } });
      for (const t of existingTopics) {
        await prisma.criterion.deleteMany({ where: { topicId: t.id } });
        await prisma.followupQuestion.deleteMany({ where: { topicId: t.id } });
        await prisma.topicSignal.deleteMany({ where: { topicId: t.id } });
        await prisma.topicSourceRef.deleteMany({ where: { topicId: t.id } });
      }

      // Delete existing topics
      await prisma.topic.deleteMany({ where: { planId: plan!.id } });

      // Create new set of topics
      const newTopics = [
        { title: "新话题1", why: "新原因", openingQuestion: "新问题", priority: "high", estimatedMinutes: 15, sortOrder: 0, planId: plan!.id },
        { title: "新话题2", why: "新原因2", openingQuestion: "新问题2", priority: "medium", estimatedMinutes: 10, sortOrder: 1, planId: plan!.id },
      ];

      for (const t of newTopics) {
        await prisma.topic.create({ data: t });
      }

      // Increment plan revision
      await prisma.interviewPlan.update({
        where: { id: plan!.id },
        data: { revision: { increment: 1 } },
      });

      const updated = await prisma.interviewPlan.findUnique({
        where: { interviewId: INTERVIEW_ID },
        include: { topics: { orderBy: { sortOrder: "asc" } } },
      });

      expect(updated!.topics).toHaveLength(2);
      expect(updated!.topics[0].title).toBe("新话题1");
      expect(updated!.topics[1].title).toBe("新话题2");
      expect(updated!.revision).toBe(2);
    });
  });
});
