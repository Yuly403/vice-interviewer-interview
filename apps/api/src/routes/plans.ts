import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { RequestUser } from "../plugins/auth.js";
import { prisma } from "../db.js";
import { getLlmConfig, isLlmConfigured } from "../llm.js";
import { chat, buildPlanGenPrompt, parsePlanGenOutput } from "@vice/llm";
import { CriterionResult, InterviewPackageSchema, TopicStatus } from "@vice/contracts";
import { publishEvent } from "../routes/sse.js";
import {
  PLAN_PROMPT_VERSION,
  classifyLlmFailure,
  parsePlanGenerationMeta,
  type LlmFailureReason,
  type PlanGenerationMode,
  type PlanGenerationMeta,
} from "../services/plan-generation.js";
import { enforceLlmRateLimit } from "../services/llm-rate-limit.js";

const EditableCriterionSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  status: z.nativeEnum(CriterionResult).optional(),
  evidenceLineIds: z.union([z.array(z.string().max(160)).max(200), z.string().max(40_000)]).optional(),
  aiExplanation: z.string().max(4_000).nullish(),
  humanOverrideValue: z.nativeEnum(CriterionResult).nullish(),
}).passthrough();

const EditableFollowupSchema = z.union([
  z.string().trim().min(1).max(2_000),
  z.object({ question: z.string().trim().min(1).max(2_000) }).passthrough(),
]);

const EditableSignalSchema = z.object({
  type: z.enum(["good", "risk"]),
  text: z.string().trim().min(1).max(2_000),
}).passthrough();

const EditableSourceRefSchema = z.object({
  sourceType: z.string().trim().min(1).max(80),
  sourceId: z.string().trim().min(1).max(160),
  sourceRevision: z.number().int().positive().nullish(),
  quote: z.string().trim().min(1).max(4_000),
  paragraphIndex: z.number().int().nonnegative().nullish(),
}).passthrough();

const EditableTopicSchema = z.object({
  title: z.string().trim().min(1).max(300),
  why: z.string().trim().min(1).max(2_000),
  openingQuestion: z.string().trim().min(1).max(2_000),
  priority: z.enum(["high", "medium", "low"]),
  estimatedMinutes: z.number().int().positive().max(120),
  status: z.nativeEnum(TopicStatus).optional(),
  locked: z.boolean().optional(),
  skipped: z.boolean().optional(),
  criteria: z.array(EditableCriterionSchema).min(1).max(20),
  followups: z.array(EditableFollowupSchema).max(20).default([]),
  signals: z.array(EditableSignalSchema).max(40).default([]),
  sourceRefs: z.array(EditableSourceRefSchema).max(40).default([]),
}).passthrough();

const PlanUpdateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  topics: z.array(EditableTopicSchema).min(1).max(12),
}).strict();

const PlanConfirmSchema = z.object({
  expectedRevision: z.number().int().positive(),
}).strict();

class PlanConflictError extends Error {}

export const planRoutes: FastifyPluginAsync = async (app) => {
  // Get plan
  app.get<{ Params: { id: string } }>("/interviews/:id/plan", async (req) => {
    const plan = await prisma.interviewPlan.findUnique({
      where: { interviewId: req.params.id },
      include: {
        topics: {
          include: { criteria: true, followups: true, signals: true, sourceRefs: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    const generationEvent = plan
      ? await prisma.auditEvent.findFirst({
          where: { interviewId: req.params.id, action: "plan.generated", targetId: plan.id },
          orderBy: { createdAt: "desc" },
          select: { newValue: true },
        })
      : null;
    const generation = parsePlanGenerationMeta(generationEvent?.newValue);
    return { data: plan ? { ...plan, generation } : plan };
  });

  // Generate plan — LLM-driven, rule-based fallback
  app.post<{ Params: { id: string } }>("/interviews/:id/plan/generate", async (req, reply) => {
    if (!enforceLlmRateLimit(req, reply, "plan", req.params.id)) return;
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.id },
      include: {
        participants: true,
        plan: { select: { confirmedAt: true } },
      },
    });

    if (!interview) return { error: "Interview not found" };
    if (interview.plan?.confirmedAt) {
      return reply.status(409).send({
        code: "PLAN_ALREADY_CONFIRMED",
        message: "A confirmed plan cannot be regenerated",
      });
    }

    const candidate = interview.participants.find((p) => p.role === "candidate");
    const positionName = interview.positionName || interview.roundType || "未知岗位";
    const packageData = (() => {
      try { return InterviewPackageSchema.safeParse(JSON.parse(interview.packageJson ?? "null")); } catch { return null; }
    })();
    const pkg = packageData?.success ? packageData.data : null;

    const startedAt = Date.now();

    // ── LLM path ──
    const llmTopics: Array<{
      title: string; why: string; openingQuestion: string;
      deepDiveQuestions: string[]; criteria: { label: string; description: string }[];
    }> = [];

    let generationMode: PlanGenerationMode = "rule-based";
    let generationModel: string | null = null;
    let fallbackReason: LlmFailureReason | undefined = "not_configured";
    let totalTokens: number | undefined;
    if (isLlmConfigured()) {
      const config = getLlmConfig();
      generationModel = config.model;
      try {
        const llmStartedAt = Date.now();
        const messages = buildPlanGenPrompt({
          positionName,
          department: undefined,
          jdText: pkg?.job.jdText,
          candidateName: candidate?.displayName ?? "候选人",
          candidateResume: pkg?.candidate.resumeText,
          verifyPoints: pkg?.screening.verificationPoints,
          durationMinutes: interview.durationMinutes ?? 45,
        });
        const result = await chat(config, messages, 4_000);
        if (!result.content.trim()) throw new Error("LLM returned empty output");
        const parsed = parsePlanGenOutput(result.content);
        llmTopics.push(...parsed.topics);
        generationMode = "llm";
        fallbackReason = undefined;
        totalTokens = result.usage?.total_tokens;
        req.log.info({
          event: "plan.llm.completed",
          interviewId: req.params.id,
          model: config.model,
          promptVersion: PLAN_PROMPT_VERSION,
          durationMs: Date.now() - llmStartedAt,
          totalTokens,
          finishReason: result.finishReason,
          topicCount: parsed.topics.length,
        }, "plan LLM generation completed");
      } catch (err) {
        fallbackReason = classifyLlmFailure(err);
        req.log.warn({
          event: "plan.llm.fallback",
          interviewId: req.params.id,
          model: config.model,
          promptVersion: PLAN_PROMPT_VERSION,
          reason: fallbackReason,
        }, "plan LLM generation failed; using rule-based fallback");
      }
    }

    // ── Fallback: rule-based template ──
    const verifyPointTopics = (pkg?.screening.verificationPoints ?? []).slice(0, 8).map((point) => ({
      title: `待验证：${point.slice(0, 50)}`,
      why: "初筛阶段标记为需要在本轮核验的事项",
      openingQuestion: `请结合具体经历说明：${point}`,
      deepDiveQuestions: ["你在其中承担的具体职责是什么？", "结果如何衡量？请给出可核验的细节。"],
      criteria: [
        { label: "可核验证据", description: "候选人给出了职责、行动和结果的具体证据" },
        { label: "个人贡献", description: "候选人能够区分个人贡献与团队整体成果" },
      ],
    }));
    const baseTopics = [
      { title: "自我介绍与背景核实", why: "了解候选人基本情况和职业路径", openingQuestion: "请简单介绍一下你的工作经历和主要负责的方向。", deepDiveQuestions: ["你最近一段工作的主要职责是什么？", "有没有跨部门协作的经验可以分享？"], criteria: [{ label: "表达清晰", description: "候选人能清晰回答问题" }, { label: "信息充分", description: "面试官获得足够信息做出判断" }] },
      { title: "核心技术能力验证", why: "验证简历声明的核心技术栈深度", openingQuestion: "请挑选一个你最有代表性的项目，详细介绍一下技术方案。", deepDiveQuestions: ["为什么选择了这个技术方案？", "如果重来一次会怎么改进？"], criteria: [{ label: "技术深度", description: "候选人对所用技术有深入理解" }, { label: "技术广度", description: "能讨论技术选型的 trade-off" }] },
      { title: "系统设计与架构能力", why: "评估候选人系统级设计能力", openingQuestion: "如果让你从零设计一个XX系统，你会怎么考虑？", deepDiveQuestions: ["如果并发量翻10倍怎么设计？", "数据一致性如何保证？"], criteria: [{ label: "系统性思维", description: "能从整体视角考虑系统设计" }, { label: "容量意识", description: "对高并发、高可用有基本概念" }] },
      { title: "问题解决与故障处理", why: "验证解决实际问题的能力", openingQuestion: "讲一次你印象最深的技术难题或线上故障，你是如何解决的？", deepDiveQuestions: ["你是怎么定位根因的？", "事后做了什么预防措施？"], criteria: [{ label: "问题定位", description: "有清晰的 trouble-shooting 思路" }, { label: "复盘改进", description: "能从故障中总结经验并推动改进" }] },
      { title: "团队协作与沟通", why: "评估团队协作软技能", openingQuestion: "描述一个你与跨团队合作的项目，你在其中的角色是什么？", deepDiveQuestions: ["遇到了什么协作上的困难？", "如何推动不同团队达成一致？"], criteria: [{ label: "协作能力", description: "能有效跨团队推动事情" }, { label: "冲突处理", description: "遇到分歧时有成熟的沟通方式" }] },
      { title: "职业规划与动机", why: "了解候选人长期发展意向", openingQuestion: "未来2-3年你在技术方向上有什么规划？", deepDiveQuestions: ["为什么考虑看新机会？", "对下一份工作的核心期望是什么？"], criteria: [{ label: "方向匹配", description: "候选人期望与岗位方向一致" }, { label: "稳定性判断", description: "跳槽动机合理，稳定性风险低" }] },
    ];
    const topics = llmTopics.length > 0
      ? llmTopics
      : [...verifyPointTopics, ...baseTopics].slice(0, 8);

    const generation: PlanGenerationMeta = {
      mode: generationMode,
      model: generationModel,
      promptVersion: PLAN_PROMPT_VERSION,
      durationMs: Date.now() - startedAt,
      ...(totalTokens !== undefined ? { totalTokens } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
      generatedAt: new Date().toISOString(),
    };

    // ── Persist atomically ──
    let generationConflict = false;
    const fullPlan = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`plan:${req.params.id}`}))`;
      const existingPlan = await tx.interviewPlan.findUnique({
        where: { interviewId: req.params.id },
        include: { topics: true },
      });
      let plan;
      if (existingPlan) {
        if (existingPlan.confirmedAt) throw new PlanConflictError("PLAN_ALREADY_CONFIRMED");
        const existingTopicIds = existingPlan.topics.map((topic) => topic.id);
        if (existingTopicIds.length > 0) {
          await tx.liveSuggestion.deleteMany({ where: { topicId: { in: existingTopicIds } } });
        }
        for (const topic of existingPlan.topics) {
          await tx.criterion.deleteMany({ where: { topicId: topic.id } });
          await tx.followupQuestion.deleteMany({ where: { topicId: topic.id } });
          await tx.topicSignal.deleteMany({ where: { topicId: topic.id } });
          await tx.topicSourceRef.deleteMany({ where: { topicId: topic.id } });
        }
        await tx.topic.deleteMany({ where: { planId: existingPlan.id } });
        plan = await tx.interviewPlan.update({
          where: { id: existingPlan.id },
          data: {
            totalDurationMinutes: interview.durationMinutes ?? 45,
            revision: { increment: 1 },
          },
        });
      } else {
        plan = await tx.interviewPlan.create({
          data: {
            interviewId: req.params.id,
            totalDurationMinutes: interview.durationMinutes ?? 45,
          },
        });
      }

      for (let i = 0; i < topics.length; i++) {
        const topic = topics[i];
        await tx.topic.create({
          data: {
            planId: plan.id,
            title: topic.title,
            why: topic.why,
            openingQuestion: topic.openingQuestion,
            priority: "high",
            estimatedMinutes: Math.max(5, Math.floor((interview.durationMinutes ?? 45) / topics.length)),
            sortOrder: i,
            criteria: {
              create: (topic.criteria || []).map((criterion: { label: string; description: string }) => ({
                text: `${criterion.label}: ${criterion.description}`,
              })),
            },
            followups: {
              create: (topic.deepDiveQuestions || []).map((question: string) => ({ question })),
            },
          },
        });
      }

      await tx.interview.update({
        where: { id: req.params.id },
        data: { status: "plan_draft", planRevision: plan.revision },
      });

      await tx.auditEvent.create({
        data: {
          interviewId: req.params.id,
          actorId: (req.user as RequestUser | undefined)?.userId ?? "system",
          action: "plan.generated",
          targetType: "plan",
          targetId: plan.id,
          newValue: JSON.stringify(generation),
          result: "success",
        },
      });

      return tx.interviewPlan.findUnique({
        where: { id: plan.id },
        include: {
          topics: {
            include: { criteria: true, followups: true, signals: true, sourceRefs: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });
    }).catch((error: unknown) => {
      if (error instanceof PlanConflictError) {
        generationConflict = true;
        return null;
      }
      throw error;
    });

    if (generationConflict) {
      return reply.status(409).send({
        code: "PLAN_ALREADY_CONFIRMED",
        message: "A confirmed plan cannot be regenerated",
      });
    }
    if (!fullPlan) throw new Error("Generated plan could not be reloaded after transaction");

    publishEvent(req.params.id, "interview.status.changed", { interviewId: req.params.id, status: "plan_draft" });
    req.log.info({
      event: "plan.generate.completed",
      interviewId: req.params.id,
      mode: generation.mode,
      model: generation.model,
      promptVersion: generation.promptVersion,
      durationMs: Date.now() - startedAt,
      topicCount: fullPlan.topics.length,
      fallbackReason: generation.fallbackReason,
    }, "plan generation persisted");

    return { data: { ...fullPlan, generation } };
  });

  // Update plan topics
  app.patch<{ Params: { id: string } }>("/interviews/:id/plan", async (req, reply) => {
    const parsed = PlanUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_PLAN_UPDATE", message: "Plan update failed validation", details: parsed.error.flatten() });
    }
    const body = parsed.data;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const plan = await tx.interviewPlan.findUnique({
          where: { interviewId: req.params.id },
          include: { topics: { select: { id: true } } },
        });
        if (!plan) throw new PlanConflictError("PLAN_NOT_FOUND");
        if (plan.confirmedAt) throw new PlanConflictError("PLAN_ALREADY_CONFIRMED");

        const claimed = await tx.interviewPlan.updateMany({
          where: { id: plan.id, revision: body.expectedRevision, confirmedAt: null },
          data: { revision: { increment: 1 } },
        });
        if (claimed.count !== 1) throw new PlanConflictError("PLAN_REVISION_CONFLICT");

        const topicIds = plan.topics.map((topic) => topic.id);
        if (topicIds.length > 0) {
          await tx.liveSuggestion.deleteMany({ where: { topicId: { in: topicIds } } });
          await tx.criterion.deleteMany({ where: { topicId: { in: topicIds } } });
          await tx.followupQuestion.deleteMany({ where: { topicId: { in: topicIds } } });
          await tx.topicSignal.deleteMany({ where: { topicId: { in: topicIds } } });
          await tx.topicSourceRef.deleteMany({ where: { topicId: { in: topicIds } } });
        }
        await tx.topic.deleteMany({ where: { planId: plan.id } });

        for (let index = 0; index < body.topics.length; index++) {
          const topic = body.topics[index];
          await tx.topic.create({
            data: {
              planId: plan.id,
              title: topic.title,
              why: topic.why,
              openingQuestion: topic.openingQuestion,
              priority: topic.priority,
              estimatedMinutes: topic.estimatedMinutes,
              status: topic.status ?? "unasked",
              locked: topic.locked ?? false,
              skipped: topic.skipped ?? false,
              sortOrder: index,
              criteria: {
                create: topic.criteria.map((criterion) => ({
                  text: criterion.text,
                  status: criterion.status ?? "missing",
                  evidenceLineIds: Array.isArray(criterion.evidenceLineIds)
                    ? JSON.stringify(criterion.evidenceLineIds)
                    : criterion.evidenceLineIds ?? "[]",
                  aiExplanation: criterion.aiExplanation ?? null,
                  humanOverrideValue: criterion.humanOverrideValue ?? null,
                })),
              },
              followups: {
                create: topic.followups.map((followup) => ({
                  question: typeof followup === "string" ? followup : followup.question,
                })),
              },
              signals: { create: topic.signals.map((signal) => ({ type: signal.type, text: signal.text })) },
              sourceRefs: {
                create: topic.sourceRefs.map((sourceRef) => ({
                  sourceType: sourceRef.sourceType,
                  sourceId: sourceRef.sourceId,
                  sourceRevision: sourceRef.sourceRevision ?? null,
                  quote: sourceRef.quote,
                  paragraphIndex: sourceRef.paragraphIndex ?? null,
                })),
              },
            },
          });
        }

        await tx.auditEvent.create({
          data: {
            interviewId: req.params.id,
            actorId: (req.user as RequestUser | undefined)?.userId ?? "system",
            action: "plan.updated",
            targetType: "plan",
            targetId: plan.id,
            newValue: JSON.stringify({ revision: body.expectedRevision + 1, topicCount: body.topics.length }),
            result: "success",
          },
        });

        return tx.interviewPlan.findUnique({
          where: { id: plan.id },
          include: { topics: { include: { criteria: true, followups: true, signals: true, sourceRefs: true }, orderBy: { sortOrder: "asc" } } },
        });
      });
      return { data: updated };
    } catch (error) {
      if (error instanceof PlanConflictError) {
        const status = error.message === "PLAN_NOT_FOUND" ? 404 : 409;
        return reply.status(status).send({ code: error.message, message: error.message === "PLAN_NOT_FOUND" ? "Plan not found" : "Plan changed or was already confirmed; reload before continuing" });
      }
      throw error;
    }
  });

  // Confirm plan
  app.post<{ Params: { id: string } }>("/interviews/:id/plan/confirm", async (req, reply) => {
    const parsed = PlanConfirmSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_PLAN_CONFIRMATION", message: "Plan confirmation failed validation", details: parsed.error.flatten() });
    }
    const userName = (req.user as RequestUser)?.displayName ?? "user";
    try {
      const plan = await prisma.$transaction(async (tx) => {
        const current = await tx.interviewPlan.findUnique({
          where: { interviewId: req.params.id },
          include: { topics: { include: { criteria: true }, orderBy: { sortOrder: "asc" } } },
        });
        if (!current) throw new PlanConflictError("PLAN_NOT_FOUND");
        if (current.confirmedAt) {
          return tx.interviewPlan.findUnique({
            where: { id: current.id },
            include: { topics: { include: { criteria: true, followups: true, signals: true, sourceRefs: true }, orderBy: { sortOrder: "asc" } } },
          });
        }
        if (current.revision !== parsed.data.expectedRevision) throw new PlanConflictError("PLAN_REVISION_CONFLICT");
        if (current.topics.length === 0 || current.topics.some((topic) => topic.criteria.length === 0)) {
          throw new PlanConflictError("PLAN_INCOMPLETE");
        }

        const interviewClaim = await tx.interview.updateMany({
          where: { id: req.params.id, status: "plan_draft" },
          data: { status: "ready" },
        });
        if (interviewClaim.count !== 1) throw new PlanConflictError("INTERVIEW_STATE_CONFLICT");

        const planClaim = await tx.interviewPlan.updateMany({
          where: { id: current.id, revision: parsed.data.expectedRevision, confirmedAt: null },
          data: { confirmedAt: new Date(), confirmedBy: userName },
        });
        if (planClaim.count !== 1) throw new PlanConflictError("PLAN_REVISION_CONFLICT");

        await tx.auditEvent.create({
          data: {
            interviewId: req.params.id,
            actorId: (req.user as RequestUser | undefined)?.userId ?? "system",
            action: "plan.confirmed",
            targetType: "plan",
            targetId: current.id,
            newValue: JSON.stringify({ revision: current.revision }),
            result: "success",
          },
        });

        return tx.interviewPlan.findUnique({
          where: { id: current.id },
          include: { topics: { include: { criteria: true, followups: true, signals: true, sourceRefs: true }, orderBy: { sortOrder: "asc" } } },
        });
      });

      if (!plan) throw new Error("Confirmed plan could not be reloaded");

      publishEvent(req.params.id, "interview.status.changed", { interviewId: req.params.id, status: "ready" });

      return { data: plan };
    } catch (error) {
      if (error instanceof PlanConflictError) {
        const status = error.message === "PLAN_NOT_FOUND" ? 404 : 409;
        return reply.status(status).send({ code: error.message, message: "Plan cannot be confirmed in its current state; reload and verify the plan" });
      }
      throw error;
    }
  });
};
