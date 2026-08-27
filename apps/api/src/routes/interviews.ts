import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { InterviewPackageSchema } from "@vice/contracts";
import type { RequestUser } from "../plugins/auth.js";
import { prisma } from "../db.js";

function visibleTo(user: RequestUser) {
  if (user.role === "admin") return {};
  return {
    OR: [
      { ownerUserId: user.userId },
      { participants: { some: { userId: user.userId } } },
      { participants: { some: { feishuOpenId: user.feishuOpenId } } },
    ],
  };
}

function packageFingerprint(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export const interviewRoutes: FastifyPluginAsync = async (app) => {
  // A list must be filtered in the database, not merely hidden by the UI.
  app.get("/interviews", async (req) => {
    const user = req.user as RequestUser;
    const interviews = await prisma.interview.findMany({
      where: visibleTo(user),
      include: {
        participants: true,
        plan: { select: { id: true, confirmedAt: true } },
        reviewDrafts: {
          where: { approvedAt: { not: null } },
          select: { id: true, humanDecision: true },
          orderBy: { revision: "desc" },
          take: 1,
        },
      },
      orderBy: { scheduledAt: "desc" },
    });
    return { data: interviews };
  });

  app.get<{ Params: { id: string } }>("/interviews/:id", async (req, reply) => {
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.id },
      include: {
        participants: true,
        plan: { include: { topics: { include: { criteria: true, followups: true }, orderBy: { sortOrder: "asc" } } } },
        reviewDrafts: { orderBy: { revision: "desc" }, take: 1 },
        captureLease: true,
      },
    });
    if (!interview) return reply.status(404).send({ code: "INTERVIEW_NOT_FOUND", message: "Interview not found" });
    return { data: interview };
  });

  // The recruiting copilot is the source of this versioned, idempotent handoff.
  app.post("/interviews/import", async (req, reply) => {
    const parsed = InterviewPackageSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_INTERVIEW_PACKAGE",
        message: "InterviewPackage failed validation",
        details: parsed.error.flatten(),
      });
    }
    const pkg = parsed.data;
    const actor = req.user as RequestUser;
    const scheduledAt = new Date(pkg.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      return reply.status(400).send({ code: "INVALID_SCHEDULE", message: "scheduledAt must be a valid ISO date" });
    }

    const existingByKey = await prisma.interview.findUnique({ where: { idempotencyKey: pkg.idempotencyKey } });
    if (existingByKey) {
      if (existingByKey.id !== pkg.interviewId) {
        return reply.status(409).send({ code: "IDEMPOTENCY_CONFLICT", message: "idempotencyKey belongs to a different interview" });
      }
      return { data: existingByKey, idempotent: true };
    }

    const existing = await prisma.interview.findUnique({ where: { id: pkg.interviewId } });
    if (existing && existing.ownerUserId && existing.ownerUserId !== actor.userId && actor.role !== "admin") {
      return reply.status(403).send({ code: "FORBIDDEN", message: "Only the owning workspace may replace an interview package" });
    }

    const packageJson = JSON.stringify(pkg);
    const packageHash = packageFingerprint(pkg);
    const interview = await prisma.$transaction(async (tx) => {
      const saved = await tx.interview.upsert({
        where: { id: pkg.interviewId },
        create: {
          id: pkg.interviewId,
          workspaceId: "default",
          ownerUserId: actor.userId,
          idempotencyKey: pkg.idempotencyKey,
          candidateKey: pkg.candidateKey,
          jobKey: pkg.jobKey,
          packageJson,
          packageHash,
          applicationId: pkg.applicationKey,
          positionName: pkg.job.title,
          roundType: pkg.round,
          scheduledAt,
          durationMinutes: pkg.durationMinutes,
          status: "package_imported",
          feishuEventId: pkg.feishuEventId,
          feishuMeetingId: null,
          packageRevision: 1,
        },
        update: {
          ownerUserId: existing?.ownerUserId ?? actor.userId,
          idempotencyKey: pkg.idempotencyKey,
          candidateKey: pkg.candidateKey,
          jobKey: pkg.jobKey,
          packageJson,
          packageHash,
          applicationId: pkg.applicationKey,
          positionName: pkg.job.title,
          roundType: pkg.round,
          scheduledAt,
          durationMinutes: pkg.durationMinutes,
          feishuEventId: pkg.feishuEventId,
          status: "package_imported",
          packageRevision: { increment: 1 },
        },
      });

      // Replacing a package replaces the schedule-derived participant set in one
      // transaction, preventing duplicate candidates on retry.
      await tx.interviewParticipant.deleteMany({ where: { interviewId: saved.id } });
      const knownUsers = await tx.user.findMany({
        where: { feishuOpenId: { in: pkg.interviewers.map((x) => x.feishuOpenId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, feishuOpenId: true },
      });
      const userIdByOpenId = new Map(knownUsers.map((x) => [x.feishuOpenId, x.id]));
      await tx.interviewParticipant.createMany({
        data: [
          ...pkg.interviewers.map((interviewer) => ({
            interviewId: saved.id,
            userId: interviewer.feishuOpenId ? userIdByOpenId.get(interviewer.feishuOpenId) ?? null : null,
            feishuOpenId: interviewer.feishuOpenId ?? null,
            displayName: interviewer.name,
            role: "interviewer",
            roleSource: "schedule",
          })),
          {
            interviewId: saved.id,
            userId: null,
            feishuOpenId: null,
            displayName: pkg.candidate.displayName,
            role: "candidate",
            roleSource: "schedule",
          },
        ],
      });
      await tx.auditEvent.create({
        data: {
          interviewId: saved.id,
          actorId: actor.userId,
          action: existing ? "interview_package_updated" : "interview_package_imported",
          targetType: "InterviewPackage",
          targetId: saved.id,
          result: "success",
        },
      });
      return saved;
    });

    return reply.status(existing ? 200 : 201).send({ data: interview, idempotent: false });
  });
};
