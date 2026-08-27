/**
 * Feishu routes — discovery, binding, and capture control endpoints.
 *
 * All endpoints under /api/v1/feishu/*.
 */

import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";
import { publishEvent } from "../routes/sse.js";
import { reconcilePostMeeting, schedulePostMeeting } from "../services/post-meeting.js";

const LIVE_CAPTURE_ENABLED = process.env.FEISHU_LIVE_CAPTURE_ENABLED === "true";

export const feishuRoutes: FastifyPluginAsync = async (app) => {
  // ─── Discovery ───────────────────────────────────────────────────────

  /** GET /feishu/meetings/active — list current active meetings for caller */
  app.get("/feishu/meetings/active", async (_req, reply) => {
    return reply.code(501).send({
      code: "LIVE_DISCOVERY_NOT_ENABLED",
      message: "内网试点不自动枚举正在进行的会议。请由招聘人员确认候选人和轮次后手动绑定会议 ID。",
    });
  });

  /** GET /feishu/meetings/search?start=&end=&query=&page_size= */
  app.get("/feishu/meetings/search", async (_req, reply) => {
    return reply.code(501).send({
      code: "LIVE_DISCOVERY_NOT_ENABLED",
      message: "内网试点不自动搜索用户会议。请由招聘人员确认候选人和轮次后手动绑定会议 ID。",
    });
  });

  // ─── Binding & capture control ──────────────────────────────────────

  /** POST /interviews/:id/bind-meeting — bind a meeting_id to an interview */
  app.post<{ Params: { id: string }; Body: { meetingId: string; autoStart?: boolean; confirmCandidateAndRound?: boolean } }>(
    "/interviews/:id/bind-meeting",
    async (req, reply) => {
      const { id } = req.params;
      const { meetingId, autoStart = false, confirmCandidateAndRound = false } = req.body ?? ({} as any);

      if (!meetingId) {
        return reply.code(400).send({ error: "meetingId is required" });
      }
      if (!/^\d+$/.test(String(meetingId).trim())) {
        return reply.code(400).send({
          error: `meetingId 必须是数字（飞书会议 ID），收到："${meetingId}"`,
        });
      }
      if (confirmCandidateAndRound !== true) {
        return reply.code(400).send({ code: "BINDING_CONFIRMATION_REQUIRED", message: "Confirm candidate, job and interview round before binding a meeting" });
      }

      const iv = await prisma.interview.findUnique({ where: { id } });
      if (!iv) {
        return reply.code(404).send({ error: "interview not found" });
      }

      const updated = await prisma.interview.update({
        where: { id },
        data: {
          feishuMeetingId: String(meetingId).trim(),
          meetingBindingSource: "manual",
          status: "bound",
        },
      });

      publishEvent(id, "interview.status.changed", { interviewId: id, status: "bound" });

      return {
        data: updated,
        captureQueued: LIVE_CAPTURE_ENABLED && autoStart,
        liveCaptureEnabled: LIVE_CAPTURE_ENABLED,
      };
    },
  );

  /** POST /interviews/:id/unbind-meeting — stop capture and unbind */
  app.post<{ Params: { id: string } }>(
    "/interviews/:id/unbind-meeting",
    async (req) => {
      const { id } = req.params;
      const iv = await prisma.interview.findUnique({ where: { id } });
      // Only step back to "ready" if currently "bound"; otherwise keep current status
      const nextStatus = iv?.status === "bound" ? "ready" : (iv?.status ?? "ready");
      const updated = await prisma.interview.update({
        where: { id },
        data: { feishuMeetingId: null, status: nextStatus },
      });

      publishEvent(id, "interview.status.changed", { interviewId: id, status: nextStatus });
      return { data: updated };
    },
  );

  /** GET /interviews/:id/capture-status — current capture worker status */
  app.get<{ Params: { id: string } }>(
    "/interviews/:id/capture-status",
    async (req) => {
      const lease = await prisma.captureLease.findUnique({ where: { interviewId: req.params.id } });
      return { data: {
        running: Boolean(lease && lease.leaseUntil > new Date()),
        lastSuccessAt: lease?.lastSuccessAt?.toISOString(),
        consecutiveFailures: 0,
        lineCount: 0,
      } };
    },
  );

  /** POST /interviews/:id/capture-restart — manually restart the worker */
  app.post<{ Params: { id: string } }>(
    "/interviews/:id/capture-restart",
    async (req, reply) => {
      if (!LIVE_CAPTURE_ENABLED) {
        return reply.code(409).send({
          code: "LIVE_CAPTURE_NOT_ENABLED",
          message: "实时字幕采集尚未在内网试点启用。当前请在会后使用飞书妙记回填逐字稿。",
        });
      }
      const iv = await prisma.interview.findUnique({ where: { id: req.params.id } });
      if (!iv?.feishuMeetingId) {
        return { error: "no meeting bound" };
      }
      await prisma.captureLease.deleteMany({ where: { interviewId: req.params.id } });
      return { data: { queued: true } };
    },
  );

  // ─── Post-meeting reconciliation ─────────────────────────────────────

  /** POST /interviews/:id/reconcile — pull minutes and merge */
  app.post<{ Params: { id: string } }>(
    "/interviews/:id/reconcile",
    async (req, reply) => {
      const { id } = req.params;
      try {
        const result = await reconcilePostMeeting(id);
        return { data: result };
      } catch (e) {
        return reply.code(500).send({ error: (e as Error).message });
      }
    },
  );

  /** POST /interviews/:id/schedule-reconcile — schedule at meeting end + 10min */
  app.post<{ Params: { id: string }; Body: { delayMinutes?: number } }>(
    "/interviews/:id/schedule-reconcile",
    async (req) => {
      const { id } = req.params;
      const delayMin = Number((req.body as any)?.delayMinutes ?? 10);
      if (!Number.isInteger(delayMin) || delayMin < 0 || delayMin > 120) {
        return { error: "delayMinutes must be an integer between 0 and 120" };
      }
      const fireAt = new Date(Date.now() + delayMin * 60_000);
      await schedulePostMeeting(id, fireAt);
      return { data: { fireAt: fireAt.toISOString() } };
    },
  );

  // ─── Suggestion feedback ───────────────────────────────────────────

  /** POST /interviews/:id/suggestions/feedback — record feedback on a LiveSuggestion */
  app.post<{ Params: { id: string } }>(
    "/interviews/:id/suggestions/feedback",
    async (req) => {
      const { id } = req.params;
      const body = req.body as { suggestionId: string; feedback: string };
      if (!body?.suggestionId || !body?.feedback) {
        return { error: "suggestionId and feedback are required" };
      }
      const suggestion = await prisma.liveSuggestion.findUnique({
        where: { id: body.suggestionId },
      });
      if (!suggestion || suggestion.interviewId !== id) {
        return { error: "suggestion not found" };
      }
      const allowedFeedback = new Set(["useful", "useless", "already_asked", "wrong_evidence", "should_not_remind"]);
      if (!allowedFeedback.has(body.feedback)) return { error: "invalid feedback" };
      await prisma.liveSuggestion.update({ where: { id: suggestion.id }, data: { feedback: body.feedback } });
      return { data: { ok: true } };
    },
  );

  // ─── Server lifecycle ────────────────────────────────────────────────

  /** POST /feishu/_admin/resume-all — used on server boot to resume workers */
};
