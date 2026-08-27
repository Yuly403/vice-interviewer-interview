import type { FastifyPluginAsync } from "fastify";
import type { RequestUser } from "../plugins/auth.js";
import { prisma } from "../db.js";
import {
  validateReviewConclusion,
  transition,
  transitionReview,
  canTransitionReview,
  isReviewEditable,
  generateInterviewArchive,
  toSafeName,
  transitionReviewApprovedToSynced,
  mapToLedgerStatus,
  detectSyncConflicts,
  parseExistingSyncMeta,
  generateSyncActions,
} from "@vice/domain";
import type { DetectionInput, SyncConflictDetail } from "@vice/domain";
import type { InterviewStatus, ReviewStatus, LedgerTransition, LedgerStatus } from "@vice/contracts";
import { getLlmConfig, isLlmConfigured } from "../llm.js";
import { chat, buildReviewGenPrompt, parseReviewGenOutput } from "@vice/llm";
import { publishEvent } from "../routes/sse.js";
import { z } from "zod";
import { archivePaths, readExistingBridgeFiles, writeApprovedReview } from "../services/workspace-bridge.js";
import { REVIEW_PROMPT_VERSION, classifyLlmFailure } from "../services/plan-generation.js";
import { enforceLlmRateLimit } from "../services/llm-rate-limit.js";

const ReviewPatchSchema = z.object({
  overview: z.string().trim().min(1).max(8000).optional(),
  strengths: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
  risks: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
  nextRoundFocus: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
  humanDecision: z.enum(["pass", "hold", "reject"]).optional(),
}).strict();

const ApprovalSchema = z.object({
  humanDecision: z.enum(["pass", "hold", "reject"]),
  reason: z.string().trim().min(1).max(2000).optional(),
}).strict();

const SyncConflictResolutionSchema = z.object({
  action: z.literal("cancel").default("cancel"),
}).strict();

export const reviewRoutes: FastifyPluginAsync = async (app) => {
  /** Safely parse a JSON string, returning fallback on error */
  function safeJsonParse<T>(raw: unknown, fallback: T): T {
    if (Array.isArray(raw)) return raw as unknown as T; // already parsed
    if (typeof raw !== "string") return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  // Get latest review draft
  app.get<{ Params: { id: string } }>("/interviews/:id/review", async (req) => {
    const draft = await prisma.reviewDraft.findFirst({
      where: { interviewId: req.params.id },
      orderBy: { revision: "desc" },
      include: {
        conclusions: {
          include: { evidenceRefs: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!draft) return { data: null };

    // Parse JSON fields (stored as strings in DB)
    return {
      data: {
        ...draft,
        strengths: safeJsonParse(draft.strengths, []),
        risks: safeJsonParse(draft.risks, []),
        openQuestions: safeJsonParse(draft.openQuestions, []),
        nextRoundFocus: safeJsonParse(draft.nextRoundFocus, []),
        uncoveredTopics: safeJsonParse(draft.uncoveredTopics, []),
      },
    };
  });

  // Generate review from transcript — LLM-driven, rule-based fallback
  app.post<{ Params: { id: string } }>("/interviews/:id/review/generate", async (req, reply) => {
    if (!enforceLlmRateLimit(req, reply, "review", req.params.id)) return;
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.id },
      include: {
        plan: { include: { topics: { include: { criteria: true }, orderBy: { sortOrder: "asc" } } } },
        participants: { where: { role: "candidate" } },
      },
    });

    if (!interview) return { error: "Interview not found" };

    const candidate = interview.participants[0];
    const positionName = interview.positionName || interview.roundType || "未知岗位";

    const transcriptLines = await prisma.transcriptLine.findMany({
      where: { interviewId: req.params.id, isDeleted: false },
      orderBy: { occurredAt: "asc" },
    });

    // Preserve earlier drafts and approvals. A regeneration is a new revision,
    // never a destructive rewrite of a record a human may already have seen.
    const latestDraft = await prisma.reviewDraft.findFirst({
      where: { interviewId: req.params.id },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    const nextRevision = (latestDraft?.revision ?? 0) + 1;

    // ── Rule-based data (used as fallback or for DB writes) ──
    const candidateLines = transcriptLines.filter((l) => l.speakerRole === "candidate");
    const makeEvidence = (line: typeof candidateLines[0]) => ({
      sourceType: "transcript" as const,
      sourceId: line.id,
      sourceRevision: line.revision,
      quote: line.text,
      speakerRole: line.speakerRole as any,
      occurredAt: line.occurredAt.toISOString(),
    });

    // ── LLM path ──
    let llmOutput: Awaited<ReturnType<typeof parseReviewGenOutput>> | null = null;
    let generationMode = "rule-based";

    if (isLlmConfigured() && transcriptLines.length > 0 && interview.plan?.topics?.length) {
      const config = getLlmConfig();
      try {
        const llmStartedAt = Date.now();
        const messages = buildReviewGenPrompt({
          positionName,
          candidateName: candidate?.displayName ?? "候选人",
          topics: interview.plan.topics.map((t) => ({
            title: t.title,
            criteria: (t.criteria || []).map((c: any) => ({
              label: c.text?.split(":")[0] ?? c.text ?? "",
              description: c.text ?? "",
            })),
          })),
          transcript: transcriptLines.map((l) => ({
            speakerRole: l.speakerRole,
            occurredAt: l.occurredAt.toISOString(),
            text: l.text,
          })),
        });
        const result = await chat(config, messages, 4_000);
        if (!result.content.trim()) throw new Error("LLM returned empty output");
        llmOutput = parseReviewGenOutput(result.content);
        generationMode = "llm";
        req.log.info({
          event: "review.llm.completed",
          interviewId: req.params.id,
          model: config.model,
          promptVersion: REVIEW_PROMPT_VERSION,
          durationMs: Date.now() - llmStartedAt,
          totalTokens: result.usage?.total_tokens,
          finishReason: result.finishReason,
          conclusionCount: llmOutput.conclusions.length,
        }, "review LLM generation completed");
      } catch (err) {
        req.log.warn({
          event: "review.llm.fallback",
          interviewId: req.params.id,
          model: config.model,
          promptVersion: REVIEW_PROMPT_VERSION,
          reason: classifyLlmFailure(err),
        }, "review LLM generation failed; using rule-based fallback");
      }
    }

    // ── Build conclusions ──
    const conclusions: Array<{
      dimension: string;
      contentType: string;
      text: string;
      aiGenerated: boolean;
      humanEdited: boolean;
      sortOrder: number;
      evidenceRefs: { create: ReturnType<typeof makeEvidence>[] };
    }> = [];

    if (llmOutput) {
      // Map LLM evidence quotes back to transcript line IDs
      for (let i = 0; i < llmOutput.conclusions.length; i++) {
        const c = llmOutput.conclusions[i];
        const matchedLines: typeof candidateLines = [];

        for (const ev of c.evidence || []) {
          // Find the best matching transcript line by quote text
          const matched = transcriptLines.find((l) =>
            l.text.includes(ev.quote.trim()) || ev.quote.trim().includes(l.text.slice(0, 30))
          );
          if (matched && matched.speakerRole === "candidate") {
            matchedLines.push(matched as any);
          }
        }

        // Deduplicate matched lines
        const seen = new Set<string>();
        const uniqueLines = matchedLines.filter((l) => {
          if (seen.has(l.id)) return false;
          seen.add(l.id);
          return true;
        });

        // An evaluation without a candidate-owned, quote-matching source is not
        // a conclusion. It becomes an evidence gap for human follow-up instead.
        if (uniqueLines.length === 0) continue;
        conclusions.push({
          dimension: c.topicTitle,
          contentType: "fact",
          text: c.verdict,
          aiGenerated: true,
          humanEdited: false,
          sortOrder: i,
          evidenceRefs: { create: uniqueLines.map(makeEvidence) },
        });
      }

      if (conclusions.length === 0) {
        generationMode = "rule-based";
        req.log.warn({
          event: "review.llm.evidence_mismatch",
          interviewId: req.params.id,
          model: getLlmConfig().model,
          promptVersion: REVIEW_PROMPT_VERSION,
        }, "review LLM conclusions had no candidate-owned quote matches; using rule-based fallback");
      } else {
        // Strengths / Risks / Overall
        const strengths = llmOutput.strengths || [];
        const risks = llmOutput.risks || [];
        const overall = llmOutput.overallAssessment || "";
        const decision = llmOutput.suggestedDecision || "hold";

        // Validate state before writing, then persist the draft and interview
        // transition atomically so a failed transition cannot leave an orphan.
        const tResult = transition(interview.status as InterviewStatus, "review_draft", {
          transcriptAvailable: transcriptLines.length > 0,
          structureValid: conclusions.length > 0,
        });
        if (!tResult.ok) {
          return { error: `State transition failed: ${tResult.reason}` };
        }

        const draft = await prisma.$transaction(async (tx) => {
          const created = await tx.reviewDraft.create({
            data: {
              interviewId: req.params.id,
              revision: nextRevision,
              reviewStatus: "draft_ready",
              overview: overall,
              strengths: JSON.stringify(strengths),
              risks: JSON.stringify(risks),
              suggestedDecision: decision,
              conclusions: { create: conclusions },
            },
            include: { conclusions: { include: { evidenceRefs: true } } },
          });
          await tx.interview.update({
            where: { id: req.params.id },
            data: { status: tResult.newStatus },
          });
          return created;
        });

        publishEvent(req.params.id, "review.draft.ready", {
          interviewId: req.params.id,
          revision: nextRevision,
          mode: generationMode,
        });
        return { data: draft, mode: generationMode };
      }
    }

    // ── Fallback: rule-based conclusions ──
    const fbConclusions = (interview.plan?.topics || []).flatMap((topic, i) => {
      const relevantLines = candidateLines.slice(i * 2, i * 2 + 2);
      if (relevantLines.length === 0) return [];
      return [{
        dimension: topic.title,
        contentType: "fact" as const,
        text: `候选人在【${topic.title}】中陈述：${relevantLines.map(l => l.text.slice(0, 160)).join("；")}`,
        aiGenerated: false,
        humanEdited: false,
        sortOrder: i,
        evidenceRefs: {
          create: relevantLines.map(makeEvidence),
        },
      }];
    });

    const tResultFallback = transition(interview.status as InterviewStatus, "review_draft", {
      transcriptAvailable: transcriptLines.length > 0,
      structureValid: fbConclusions.length > 0,
    });
    if (!tResultFallback.ok) {
      return { error: `State transition failed: ${tResultFallback.reason}` };
    }

    const draft = await prisma.$transaction(async (tx) => {
      const created = await tx.reviewDraft.create({
        data: {
          interviewId: req.params.id,
          revision: nextRevision,
          reviewStatus: "draft_ready",
          overview: `本轮面试共${transcriptLines.length}条对话记录，候选人回答了${candidateLines.length}条。`,
          strengths: JSON.stringify([]),
          risks: JSON.stringify([]),
          openQuestions: JSON.stringify((interview.plan?.topics || [])
            .filter((topic) => !fbConclusions.some((conclusion) => conclusion.dimension === topic.title))
            .map((topic) => `证据不足：${topic.title}`)),
          conclusions: { create: fbConclusions },
        },
        include: { conclusions: { include: { evidenceRefs: true } } },
      });
      await tx.interview.update({
        where: { id: req.params.id },
        data: { status: tResultFallback.newStatus },
      });
      return created;
    });

    publishEvent(req.params.id, "review.draft.ready", {
      interviewId: req.params.id,
      revision: nextRevision,
      mode: generationMode,
    });
    return { data: draft, mode: generationMode };
  });

  // Update review draft
  app.patch<{ Params: { id: string } }>("/interviews/:id/review", async (req, reply) => {
    const parsedBody = ReviewPatchSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ code: "INVALID_REVIEW_PATCH", message: "Review patch failed validation", details: parsedBody.error.flatten() });
    }
    const body = parsedBody.data;
    const draft = await prisma.reviewDraft.findFirst({
      where: { interviewId: req.params.id },
      orderBy: { revision: "desc" },
    });

    if (!draft) return reply.status(404).send({ code: "REVIEW_NOT_FOUND", message: "No review draft found" });

    // Determine new review status using domain state machine
    const currentReviewStatus = draft.reviewStatus || "draft_ready";
    if (!isReviewEditable(currentReviewStatus as ReviewStatus)) {
      return reply.status(409).send({ code: "REVIEW_IMMUTABLE", message: "An approved, syncing, or synced review cannot be changed. Create a new revision instead." });
    }
    const newReviewStatus = "editing";

    const updated = await prisma.reviewDraft.update({
      where: { id: draft.id },
      data: {
        reviewStatus: newReviewStatus,
        ...(body.overview !== undefined && { overview: body.overview }),
        ...(body.strengths !== undefined && { strengths: JSON.stringify(body.strengths) }),
        ...(body.risks !== undefined && { risks: JSON.stringify(body.risks) }),
        ...(body.nextRoundFocus !== undefined && { nextRoundFocus: JSON.stringify(body.nextRoundFocus) }),
        ...(body.humanDecision !== undefined && { humanDecision: body.humanDecision }),
        revision: { increment: 1 },
      },
    });

    return {
      data: {
        ...updated,
        strengths: safeJsonParse(updated.strengths, []),
        risks: safeJsonParse(updated.risks, []),
        openQuestions: safeJsonParse(updated.openQuestions, []),
        nextRoundFocus: safeJsonParse(updated.nextRoundFocus, []),
        uncoveredTopics: safeJsonParse(updated.uncoveredTopics, []),
      },
    };
  });

  // Approve review — domain state machine driven (PRD F2-1)
  app.post<{ Params: { id: string } }>("/interviews/:id/review/approve", async (req, reply) => {
    const parsedBody = ApprovalSchema.safeParse(req.body);
    if (!parsedBody.success) return reply.status(400).send({ code: "INVALID_APPROVAL", message: "Approval failed validation", details: parsedBody.error.flatten() });
    const body = parsedBody.data;
    const idempotencyKey = req.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 12 || idempotencyKey.length > 200) {
      return reply.status(400).send({ code: "IDEMPOTENCY_KEY_REQUIRED", message: "A valid Idempotency-Key header is required" });
    }
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.id },
    });
    if (!interview) return reply.status(404).send({ code: "INTERVIEW_NOT_FOUND", message: "Interview not found" });

    const draft = await prisma.reviewDraft.findFirst({
      where: { interviewId: req.params.id },
      orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
      include: { conclusions: { include: { evidenceRefs: true } } },
    });

    if (!draft) return reply.status(404).send({ code: "REVIEW_NOT_FOUND", message: "No review draft found" });

    // Validate all conclusions have evidence
    const transcriptLines = await prisma.transcriptLine.findMany({
      where: { interviewId: req.params.id, isDeleted: false },
    });

    let evidenceValid = true;
    for (const conclusion of draft.conclusions) {
      const result = validateReviewConclusion(conclusion as any, transcriptLines as any);
      if (!result.valid) {
        evidenceValid = false;
        return reply.status(422).send({ code: "EVIDENCE_VALIDATION_FAILED", message: "Evidence validation failed", details: result.errors });
      }
    }

    const user = req.user as RequestUser;
    const currentReviewStatus = (draft.reviewStatus || "draft_ready") as ReviewStatus;

    // ── Review-level state machine transition ──
    const pendingTransition = transitionReview(currentReviewStatus, "approval_pending");
    if (!pendingTransition.ok) return reply.status(409).send({ code: "INVALID_REVIEW_STATE", message: pendingTransition.reason });
    const reviewTransition = transitionReview("approval_pending", "approved", {
      evidenceValidationPassed: evidenceValid,
      strongIdentity: Boolean(user.userId && user.feishuOpenId),
      idempotencyKey: true,
    });
    if (!reviewTransition.ok) {
      return reply.status(409).send({ code: "INVALID_REVIEW_STATE", message: reviewTransition.reason });
    }

    // ── Interview-level state machine transition ──
    const interviewTransition = transition(interview.status as InterviewStatus, "review_approved");
    if (!interviewTransition.ok) {
      return reply.status(409).send({ code: "INVALID_INTERVIEW_STATE", message: interviewTransition.reason });
    }

    // ── Persist both transitions atomically ──
    const existingApproval = await prisma.approval.findUnique({ where: { idempotencyKey } });
    if (existingApproval) {
      if (existingApproval.interviewId !== req.params.id || existingApproval.targetId !== draft.id) {
        return reply.status(409).send({ code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was used for another approval" });
      }
      return { data: draft, idempotent: true, message: "Review approval already recorded" };
    }

    // ── SYNC-002: 台账建议状态（审批时初步计算，sync 时覆盖确认）──
    const isFinalRound = interview.roundType.includes("final");
    const existingLedger = JSON.parse(interview.ledgerTransitions || "[]") as LedgerTransition[];

    const ledgerResult = mapToLedgerStatus({
      interviewStatus: interviewTransition.newStatus,
      reviewStatus: reviewTransition.newStatus,
      suggestedDecision: draft.suggestedDecision,
      humanDecision: body.humanDecision,
      isFinalRound,
      currentLedgerStatus: (interview.ledgerStatus as any) || null,
    });

    const ledgerTransitions: LedgerTransition[] = [...existingLedger];
    if (ledgerResult.transition) {
      ledgerTransitions.push(ledgerResult.transition);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const approved = await tx.reviewDraft.update({
        where: { id: draft.id },
        data: { reviewStatus: reviewTransition.newStatus, humanDecision: body.humanDecision, approvedBy: user.userId, approvedAt: new Date() },
      });
      await tx.interview.update({
        where: { id: req.params.id },
        data: { status: interviewTransition.newStatus, approvedReviewRevision: draft.revision, ledgerStatus: ledgerResult.status, ledgerTransitions: JSON.stringify(ledgerTransitions) },
      });
      await tx.approval.create({
        data: { interviewId: req.params.id, targetType: "review", targetId: draft.id, targetRevision: draft.revision, action: "approve", approvedBy: user.userId, reason: body.reason, idempotencyKey },
      });
      await tx.auditEvent.create({
        data: { interviewId: req.params.id, actorId: user.userId, action: "review.approved", targetType: "review", targetId: draft.id, result: "success" },
      });
      await tx.outboxEvent.create({
        data: { interviewId: req.params.id, eventType: "review.approved", payloadJson: JSON.stringify({ reviewId: draft.id, revision: draft.revision }), dedupeKey: `review.approved:${draft.id}:${draft.revision}` },
      });
      return approved;
    });

    publishEvent(req.params.id, "interview.status.changed", {
      interviewId: req.params.id,
      status: interviewTransition.newStatus,
    });

    return {
      data: updated,
      reviewStatus: reviewTransition.newStatus,
      interviewStatus: interviewTransition.newStatus,
      ledgerStatus: ledgerResult.status,
      ledgerLabel: ledgerResult.label,
      ledgerNote: ledgerResult.note,
      message: "Review approved",
    };
  });

  // ── SYNC-003: 冲突检测辅助函数 ──
  async function buildSyncDetectionInput(
    interviewId: string,
    draft: Awaited<ReturnType<typeof prisma.reviewDraft.findFirst>> & {
      conclusions: Array<{
        dimension: string;
        text: string;
        evidenceRefs: Array<{ sourceId: string; sourceRevision: number; quote: string }>;
      }>;
    }
  ): Promise<{
    detectionInput: DetectionInput;
    candidateSafeName: string;
  }> {
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: { participants: true },
    });
    const candidate = interview?.participants.find((p) => p.role === "candidate");
    const candidateSafeName = candidate ? toSafeName(candidate.displayName) : "unknown_candidate";
    const bridgePaths = archivePaths(candidateSafeName, interviewId);

    // 读取已有工作区文件（若存在）
    const existing = readExistingBridgeFiles(bridgePaths);
    const existingSyncMeta = existing.syncMetadata ? parseExistingSyncMeta(existing.syncMetadata) : null;
    const existingMarkdown = existing.reviewMarkdown;

    // 读取逐字稿行（用于 stale_line 检测）
    const transcriptLines = await prisma.transcriptLine.findMany({
      where: { interviewId, isDeleted: false },
      select: { id: true, revision: true, isDeleted: true, text: true },
    });

    const detectionInput: DetectionInput = {
      draft: {
        revision: draft.revision,
        suggestedDecision: draft.suggestedDecision,
        humanDecision: draft.humanDecision,
        overview: draft.overview,
        strengths: JSON.parse(draft.strengths || "[]"),
        risks: JSON.parse(draft.risks || "[]"),
        conclusions: draft.conclusions.map((c) => ({
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
      existingSyncMeta,
      existingMarkdown,
      isFinalRound: interview?.roundType?.includes("final") ?? false,
    };

    return { detectionInput, candidateSafeName };
  }

  // ── SYNC-001 + SYNC-003: 面评回写候选人档案（含冲突检测）───
  // POST /api/v1/interviews/:id/review/sync
  // 将已审批面评写入 03-interview/<候选人>/rounds/<interviewId>/
  app.post<{ Params: { id: string } }>("/interviews/:id/review/sync", async (req, reply) => {
    try {
      // 1. Load interview with all related data
      const interview = await prisma.interview.findUnique({
        where: { id: req.params.id },
        include: {
          participants: true,
          plan: { include: { topics: { orderBy: { sortOrder: "asc" } } } },
        },
      });

      if (!interview) return reply.status(404).send({ code: "INTERVIEW_NOT_FOUND", message: "Interview not found" });

      if (interview.status === "synced") {
        const existingSync = await prisma.workspaceSync.findFirst({
          where: { interviewId: req.params.id, status: "synced" },
          orderBy: { reviewRevision: "desc" },
        });
        if (existingSync) {
          return {
            data: {
              status: "synced",
              archivePath: existingSync.targetPath,
              manifest: safeJsonParse(existingSync.manifestJson, {}),
            },
            idempotent: true,
          };
        }
        return reply.status(409).send({ code: "SYNC_STATE_INCONSISTENT", message: "Interview is synced but has no sync manifest" });
      }

      // 2. Verify interview is in review_approved state
      if (interview.status !== "review_approved") {
        return reply.status(409).send({ code: "INVALID_INTERVIEW_STATE", message: `Interview must be in review_approved state, current: ${interview.status}` });
      }

      // 3. Load approved review draft
      const draft = await prisma.reviewDraft.findFirst({
        where: { interviewId: req.params.id, approvedAt: { not: null } },
        orderBy: { revision: "desc" },
        include: {
          conclusions: {
            include: { evidenceRefs: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      if (!draft) return reply.status(404).send({ code: "APPROVED_REVIEW_NOT_FOUND", message: "No approved review draft found" });

      // 4. State machine pre-check
      // Review-level: verify current status can reach sync_pending
      const currentReviewStatus = (draft.reviewStatus || "approved") as ReviewStatus;

      // Determine if this is a force-retry sync (conflicts were force-resolved)
      const isForceRetry =
        currentReviewStatus === "sync_pending" &&
        draft.syncConflictsResolvedAt != null &&
        draft.syncConflicts === null;

      if (currentReviewStatus !== "sync_pending" && !canTransitionReview(currentReviewStatus, "sync_pending")) {
        return reply.status(409).send({ code: "INVALID_REVIEW_STATE", message: `Cannot sync: review status ${currentReviewStatus} cannot transition to sync_pending` });
      }

      // Interview-level: verify review_approved → synced is valid
      const interviewSync = transitionReviewApprovedToSynced(true);
      if (!interviewSync.ok) {
        return reply.status(409).send({ code: "INVALID_INTERVIEW_STATE", message: `Interview state transition failed: ${interviewSync.reason}` });
      }

      // ── SYNC-003: 冲突检测（force-retry 跳过）───
      // 声明在外层作用域，后续写入步骤共用
      let candidateSafeName = "";

      if (!isForceRetry) {
        const detectionData = await buildSyncDetectionInput(
          req.params.id,
          draft as any
        );

        const detectionResult = detectSyncConflicts(detectionData.detectionInput);

        candidateSafeName = detectionData.candidateSafeName;

        if (detectionResult.hasConflicts) {
          // 有冲突 → 设置 sync_conflict 状态，存储冲突快照，停止同步
          await prisma.reviewDraft.update({
            where: { id: draft.id },
            data: {
              reviewStatus: "sync_conflict",
              syncConflicts: JSON.stringify(detectionResult.conflicts),
            },
          });

          // 审计事件
          await prisma.auditEvent.create({
            data: {
              interviewId: req.params.id,
              actorId: (req.user as any)?.feishuOpenId || "system",
              action: "review.sync_conflict_detected",
              targetType: "review",
              targetId: draft.id,
              newValue: JSON.stringify({
                conflictTypes: detectionResult.conflictTypes,
                conflictCount: detectionResult.conflicts.length,
              }),
              result: "blocked",
            },
          });

          publishEvent(req.params.id, "review.sync_conflict", {
            interviewId: req.params.id,
            conflictTypes: detectionResult.conflictTypes,
            conflictCount: detectionResult.conflicts.length,
            conflicts: detectionResult.conflicts,
          });

          return {
            data: {
              status: "sync_conflict",
              conflictTypes: detectionResult.conflictTypes,
              conflictCount: detectionResult.conflicts.length,
              conflicts: detectionResult.conflicts,
            },
            message:
              `检测到 ${detectionResult.conflicts.length} 个同步冲突（${detectionResult.conflictTypes.join(", ")}）。请处理冲突后重试同步。`,
          };
        }
        // 无冲突 → 继续同步流程（退出 if 块）
      } else {
        // force-retry: compute paths manually since we skip detection
        const interviewForPath = await prisma.interview.findUnique({
          where: { id: req.params.id },
          include: { participants: true },
        });
        const candidate = interviewForPath?.participants.find((p) => p.role === "candidate");
        candidateSafeName = candidate ? toSafeName(candidate.displayName) : "unknown_candidate";
      }

      // 5. 无冲突或 force-retry → Mark review as sync_pending (if not already), count transcript, then generate archive
      if (currentReviewStatus !== "sync_pending") {
        await prisma.reviewDraft.update({
          where: { id: draft.id },
          data: { reviewStatus: "sync_pending" },
        });
      }

      const transcriptCount = await prisma.transcriptLine.count({
        where: { interviewId: req.params.id, isDeleted: false },
      });

      // 6. Generate archive
      const archiveInput = {
        interviewId: req.params.id,
        revision: draft.revision,
        scheduledAt: interview.scheduledAt.toISOString(),
        roundType: interview.roundType,
        positionName: interview.positionName || null,
        participants: interview.participants.map((p) => ({
          displayName: p.displayName,
          role: p.role,
        })),
        overview: draft.overview,
        strengths: JSON.parse(draft.strengths || "[]"),
        risks: JSON.parse(draft.risks || "[]"),
        openQuestions: JSON.parse(draft.openQuestions || "[]"),
        uncoveredTopics: JSON.parse(draft.uncoveredTopics || "[]"),
        nextRoundFocus: JSON.parse(draft.nextRoundFocus || "[]"),
        suggestedDecision: draft.suggestedDecision,
        humanDecision: draft.humanDecision,
        approvedBy: draft.approvedBy,
        approvedAt: draft.approvedAt?.toISOString() || null,
        conclusions: draft.conclusions.map((c) => ({
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
        topics: (interview.plan?.topics || []).map((t) => ({
          title: t.title,
          why: t.why,
          status: t.status,
        })),
        transcriptLineCount: transcriptCount,
      };

      const archive = generateInterviewArchive(archiveInput);

      // 7-8. The Bridge is the only filesystem writer. It validates an
      // allowlisted root and uses temp-file + rename atomic writes.
      const bridgeResult = writeApprovedReview(
        archivePaths(candidateSafeName, req.params.id),
        archive.markdown,
        archive.syncMeta,
        Boolean((req.body as { dryRun?: boolean } | undefined)?.dryRun),
      );
      if (!bridgeResult.written) {
        return { data: { status: "dry_run", manifest: bridgeResult }, message: "Workspace Bridge validation succeeded; no files were written" };
      }
      const reviewMdPath = bridgeResult.reviewPath;

      // 9. Clear conflict snapshot + update status to synced
      await prisma.reviewDraft.update({
        where: { id: draft.id },
        data: {
          reviewStatus: "synced",
          syncConflicts: null,
          syncConflictsResolvedAt: new Date(),
        },
      });

      await prisma.interview.update({
        where: { id: req.params.id },
        data: { status: "synced" },
      });

      await prisma.workspaceSync.upsert({
        where: { interviewId_reviewRevision: { interviewId: req.params.id, reviewRevision: draft.revision } },
        create: { interviewId: req.params.id, reviewRevision: draft.revision, status: "synced", manifestJson: JSON.stringify(bridgeResult), contentHash: bridgeResult.contentHash, targetPath: reviewMdPath },
        update: { status: "synced", manifestJson: JSON.stringify(bridgeResult), contentHash: bridgeResult.contentHash, targetPath: reviewMdPath, errorCode: null },
      });

      // ── SYNC-002: 台账状态映射 ──
      const isFinalRound = interview.roundType.includes("final");
      const existingLedger = JSON.parse(interview.ledgerTransitions || "[]") as LedgerTransition[];

      const ledgerResult = mapToLedgerStatus({
        interviewStatus: "synced",
        reviewStatus: draft.reviewStatus,
        suggestedDecision: draft.suggestedDecision,
        humanDecision: draft.humanDecision,
        isFinalRound,
        currentLedgerStatus: (interview.ledgerStatus as any) || null,
      });

      const ledgerTransitions: LedgerTransition[] = [...existingLedger];
      if (ledgerResult.transition) {
        ledgerTransitions.push(ledgerResult.transition);
      }

      await prisma.interview.update({
        where: { id: req.params.id },
        data: {
          ledgerStatus: ledgerResult.status,
          ledgerTransitions: JSON.stringify(ledgerTransitions),
        },
      });

      // ── SYNC-004: 后续动作建议 ──
      const followupInput = {
        humanDecision: draft.humanDecision,
        suggestedDecision: draft.suggestedDecision,
        isFinalRound,
        ledgerStatus: ledgerResult.status,
        ledgerAutoEffective: ledgerResult.autoEffective,
        openQuestionCount: JSON.parse(draft.openQuestions || "[]").length,
        uncoveredTopicCount: JSON.parse(draft.uncoveredTopics || "[]").length,
        nextRoundFocusCount: JSON.parse(draft.nextRoundFocus || "[]").length,
        evidenceCount: archive.syncMeta.evidenceCount,
        strengthCount: JSON.parse(draft.strengths || "[]").length,
        riskCount: JSON.parse(draft.risks || "[]").length,
        hadConflicts: draft.syncConflictsResolvedAt != null,
      };
      const followup = generateSyncActions(followupInput);

      // 10. Create audit event
      await prisma.auditEvent.create({
        data: {
          interviewId: req.params.id,
          actorId: (req.user as any)?.feishuOpenId || "system",
          action: "review.synced",
          targetType: "review",
          targetId: draft.id,
          newValue: JSON.stringify({
            archivePath: reviewMdPath,
            ...archive.syncMeta,
            candidateSafeName,
          }),
          result: "success",
        },
      });

      publishEvent(req.params.id, "review.synced", {
        interviewId: req.params.id,
        archivePath: reviewMdPath,
        syncMeta: archive.syncMeta,
      });

      return {
        data: {
          archivePath: reviewMdPath,
          syncMeta: archive.syncMeta,
          status: "synced",
          ledgerStatus: ledgerResult.status,
          ledgerLabel: ledgerResult.label,
          ledgerAutoEffective: ledgerResult.autoEffective,
          ledgerNote: ledgerResult.note,
          followupActions: followup.actions,
          followupSummary: followup.summary,
          followupBreakdown: followup.breakdown,
          primaryAction: followup.primaryAction,
        },
        message: "Interview archive written to workspace",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ code: "SYNC_FAILED", message: "Workspace sync failed", detail: msg });
    }
  });

  // ── SYNC-003: 查询同步冲突 ──
  // GET /api/v1/interviews/:id/review/sync-conflicts
  // 返回当前草稿上保存的冲突快照
  app.get<{ Params: { id: string } }>("/interviews/:id/review/sync-conflicts", async (req) => {
    const draft = await prisma.reviewDraft.findFirst({
      where: { interviewId: req.params.id, reviewStatus: "sync_conflict" },
      orderBy: { revision: "desc" },
      select: { id: true, revision: true, reviewStatus: true, syncConflicts: true },
    });

    if (!draft) {
      return { data: { hasConflicts: false, conflicts: [], status: null } };
    }

    let conflicts: SyncConflictDetail[] = [];
    try {
      conflicts = JSON.parse(draft.syncConflicts || "[]");
    } catch { /* ignore */ }

    return {
      data: {
        hasConflicts: conflicts.length > 0,
        conflicts,
        count: conflicts.length,
        status: draft.reviewStatus,
        revision: draft.revision,
      },
    };
  });

  // ── SYNC-003: 解决同步冲突 ──
  // POST /api/v1/interviews/:id/review/sync-conflicts/resolve
  // 将 sync_conflict → sync_pending（人工确认后可重试同步）
  app.post<{ Params: { id: string } }>("/interviews/:id/review/sync-conflicts/resolve", async (req, reply) => {
    const parsed = SyncConflictResolutionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_CONFLICT_RESOLUTION", message: "Only cancel is supported; edit and re-approve the review before syncing again" });
    }
    const action = parsed.data.action as "cancel" | "force" | "retry";

    const draft = await prisma.reviewDraft.findFirst({
      where: { interviewId: req.params.id, reviewStatus: "sync_conflict" },
      orderBy: { revision: "desc" },
    });

    if (!draft) {
      return reply.status(404).send({ code: "SYNC_CONFLICT_NOT_FOUND", message: "No review draft in sync_conflict state" });
    }

    const currentReviewStatus = draft.reviewStatus as ReviewStatus;

    // 处理不同动作
    switch (action) {
      case "cancel": {
        // 取消同步，回退到 approved 状态
        const revertTransition = transitionReview(currentReviewStatus, "approved");
        if (!revertTransition.ok) {
          // sync_conflict → approved 不是直接转换，回退到 approved 需要走不同的路径
          // 实际上 sync_conflict → sync_pending → approved 不成立
          // 所以 cancel 就是清除冲突标记，保持可编辑状态
          // 最合理的做法是：清除冲突，回到 approval_pending
          const revertTransition2 = transitionReview("sync_conflict", "sync_pending");
          if (!revertTransition2.ok) {
            return { error: `Cannot cancel sync conflict: ${revertTransition2.reason}` };
          }
          // 从 sync_pending 手动推进到 draft_ready（需要覆盖状态机）
          await prisma.reviewDraft.update({
            where: { id: draft.id },
            data: {
              reviewStatus: "draft_ready",
              syncConflicts: null,
              syncConflictsResolvedAt: new Date(),
            },
          });
        } else {
          await prisma.reviewDraft.update({
            where: { id: draft.id },
            data: {
              reviewStatus: "approved",
              syncConflicts: null,
              syncConflictsResolvedAt: new Date(),
            },
          });
        }

        await prisma.auditEvent.create({
          data: {
            interviewId: req.params.id,
            actorId: (req.user as any)?.feishuOpenId || "system",
            action: "review.sync_conflict_cancelled",
            targetType: "review",
            targetId: draft.id,
            result: "success",
          },
        });

        return {
          data: { action: "cancel", status: "draft_ready" },
          message: "已取消同步，面评草稿已回到可编辑状态。请修改后重新审批。",
        };
      }

      case "force": {
        // 强制同步（跳过冲突检测）
        const forceTransition = transitionReview(currentReviewStatus, "sync_pending", {
          workspaceConflictsResolved: true,
        });
        if (!forceTransition.ok) {
          return { error: `Force resolve failed: ${forceTransition.reason}` };
        }

        await prisma.reviewDraft.update({
          where: { id: draft.id },
          data: {
            reviewStatus: "sync_pending",
            syncConflicts: null,
            syncConflictsResolvedAt: new Date(),
          },
        });

        await prisma.auditEvent.create({
          data: {
            interviewId: req.params.id,
            actorId: (req.user as any)?.feishuOpenId || "system",
            action: "review.sync_conflict_force_resolved",
            targetType: "review",
            targetId: draft.id,
            newValue: JSON.stringify({ forceResolvedAt: new Date().toISOString() }),
            result: "success",
          },
        });

        publishEvent(req.params.id, "review.sync_conflict_resolved", {
          interviewId: req.params.id,
          action: "force",
        });

        return {
          data: { action: "force", status: "sync_pending" },
          message: "冲突已强制解决，可以重新发起同步（下次 sync 将跳过冲突检测）。",
        };
      }

      case "retry":
      default: {
        // 重试：清除冲突，回到 sync_pending
        const retryTransition = transitionReview(currentReviewStatus, "sync_pending", {
          workspaceConflictsResolved: true,
        });
        if (!retryTransition.ok) {
          return { error: `Retry transition failed: ${retryTransition.reason}` };
        }

        await prisma.reviewDraft.update({
          where: { id: draft.id },
          data: {
            reviewStatus: "sync_pending",
            syncConflicts: null,
            syncConflictsResolvedAt: new Date(),
          },
        });

        await prisma.auditEvent.create({
          data: {
            interviewId: req.params.id,
            actorId: (req.user as any)?.feishuOpenId || "system",
            action: "review.sync_conflict_retry",
            targetType: "review",
            targetId: draft.id,
            newValue: JSON.stringify({ retryAt: new Date().toISOString() }),
            result: "success",
          },
        });

        publishEvent(req.params.id, "review.sync_conflict_resolved", {
          interviewId: req.params.id,
          action: "retry",
        });

        return {
          data: { action: "retry", status: "sync_pending" },
          message: "冲突已确认处理，可以重新发起同步。",
        };
      }
    }
  });

  // ── SYNC-004: 查询后续动作建议 ──
  // GET /api/v1/interviews/:id/review/sync-actions
  // 返回基于当前面试状态和面评草稿的后续动作建议列表
  app.get<{ Params: { id: string } }>("/interviews/:id/review/sync-actions", async (req) => {
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.id },
      select: {
        roundType: true,
        ledgerStatus: true,
      },
    });

    if (!interview) return { error: "Interview not found" };

    const draft = await prisma.reviewDraft.findFirst({
      where: { interviewId: req.params.id },
      orderBy: { revision: "desc" },
      include: {
        conclusions: { include: { evidenceRefs: true } },
      },
    });

    if (!draft) {
      return {
        data: { available: false, actions: [], summary: "尚未生成面评草稿，无法给出后续动作建议。" },
      };
    }

    const isFinalRound = interview.roundType.includes("final");
    const ledgerStatus = (interview.ledgerStatus as LedgerStatus) || "not_set";

    // 计算台账映射以获取 autoEffective
    const ledgerResult = mapToLedgerStatus({
      interviewStatus: "synced",
      reviewStatus: draft.reviewStatus,
      suggestedDecision: draft.suggestedDecision,
      humanDecision: draft.humanDecision,
      isFinalRound,
      currentLedgerStatus: ledgerStatus,
    });

    const followupInput = {
      humanDecision: draft.humanDecision,
      suggestedDecision: draft.suggestedDecision,
      isFinalRound,
      ledgerStatus: ledgerResult.status,
      ledgerAutoEffective: ledgerResult.autoEffective,
      openQuestionCount: JSON.parse(draft.openQuestions || "[]").length,
      uncoveredTopicCount: JSON.parse(draft.uncoveredTopics || "[]").length,
      nextRoundFocusCount: JSON.parse(draft.nextRoundFocus || "[]").length,
      evidenceCount: draft.conclusions.reduce(
        (sum: number, c) => sum + (c.evidenceRefs?.length || 0),
        0
      ),
      strengthCount: JSON.parse(draft.strengths || "[]").length,
      riskCount: JSON.parse(draft.risks || "[]").length,
      hadConflicts: draft.syncConflictsResolvedAt != null,
    };

    const followup = generateSyncActions(followupInput);

    return {
      data: {
        available: true,
        actions: followup.actions,
        summary: followup.summary,
        breakdown: followup.breakdown,
        primaryAction: followup.primaryAction,
        context: {
          humanDecision: draft.humanDecision,
          isFinalRound,
          ledgerStatus: ledgerResult.status,
          ledgerAutoEffective: ledgerResult.autoEffective,
          openQuestionCount: followupInput.openQuestionCount,
          uncoveredTopicCount: followupInput.uncoveredTopicCount,
        },
      },
    };
  });

  // Export result package
  app.get<{ Params: { id: string } }>("/interviews/:id/review/export", async (req, reply) => {
    const draft = await prisma.reviewDraft.findFirst({
      where: { interviewId: req.params.id, approvedAt: { not: null } },
      orderBy: { revision: "desc" },
      include: { conclusions: { include: { evidenceRefs: true }, orderBy: { sortOrder: "asc" } } },
    });

    if (!draft) return reply.status(404).send({ code: "APPROVED_REVIEW_NOT_FOUND", message: "No approved review found" });
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.id },
      select: { candidateKey: true, jobKey: true },
    });
    if (!interview?.candidateKey || !interview.jobKey) {
      return reply.status(409).send({ code: "PACKAGE_CONTEXT_MISSING", message: "InterviewPackage context is required before exporting a result" });
    }

    const resultPackage = {
      schemaVersion: "1.0",
      interviewId: req.params.id,
      candidateKey: interview.candidateKey,
      jobKey: interview.jobKey,
      reviewStatus: "approved",
      approvedBy: draft.approvedBy || "unknown",
      approvedAt: draft.approvedAt?.toISOString(),
      dimensionReviews: draft.conclusions.map((c) => ({
        dimension: c.dimension,
        summary: c.text,
        evidenceRefs: c.evidenceRefs,
      })),
      strengths: JSON.parse(draft.strengths || "[]"),
      risks: JSON.parse(draft.risks || "[]"),
      openQuestions: JSON.parse(draft.openQuestions || "[]"),
      humanDecision: draft.humanDecision || "hold",
      nextRoundFocus: JSON.parse(draft.nextRoundFocus || "[]"),
      evidenceManifest: draft.conclusions.flatMap((c) =>
        c.evidenceRefs.map((e) => ({
          lineId: e.sourceId,
          sourceType: e.sourceType,
          quotePreview: e.quote.slice(0, 60),
        }))
      ),
      sourceRevision: draft.revision,
    };

    return { data: resultPackage };
  });
};
