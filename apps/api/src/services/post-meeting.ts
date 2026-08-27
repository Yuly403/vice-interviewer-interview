/**
 * Post-meeting service — after the meeting ends, fetch the full transcript
 * from the Feishu minute artifact and reconcile with what was captured live.
 *
 * This handles the "what if the agent switch was off mid-meeting" case:
 * live capture may have gaps, but the minutes artifact is the source of truth.
 */

import { prisma } from "../db.js";
import { publishEvent } from "../routes/sse.js";
import {
  describeFeishuServerError,
  getServerMinuteTranscript,
  resolveMinuteToken,
} from "./feishu-server.js";

export interface PostMeetingResult {
  interviewId: string;
  meetingId: string;
  minuteToken: string | null;
  imported: number;
  updated: number;
  skipped: number;
  error?: string;
}

/**
 * Fetch meeting minutes and reconcile with live transcript.
 * Idempotent: re-running the same minute_token will not create duplicates.
 */
export async function reconcilePostMeeting(
  interviewId: string,
  opts: { meetingId?: string } = {},
): Promise<PostMeetingResult> {
  const iv = await prisma.interview.findUnique({ where: { id: interviewId } });
  if (!iv) throw new Error(`interview not found: ${interviewId}`);

  const meetingId = opts.meetingId ?? iv.feishuMeetingId;
  if (!meetingId) {
    return {
      interviewId,
      meetingId: "",
      minuteToken: null,
      imported: 0,
      updated: 0,
      skipped: 0,
      error: "no meeting bound",
    };
  }

  // Step 1: resolve a completed Minutes artifact through the server-side
  // Open Platform API. This avoids relying on a locally logged-in CLI.
  const minuteResult = await resolveMinuteToken(meetingId);
  if (!minuteResult.ok) {
    return {
      interviewId,
      meetingId,
      minuteToken: null,
      imported: 0,
      updated: 0,
      skipped: 0,
      error: describeFeishuServerError(minuteResult.error),
    };
  }
  const minuteToken = minuteResult.data;

  // Step 2: fetch transcript
  const tr = await getServerMinuteTranscript(minuteToken);
  if (!tr.ok) {
    return {
      interviewId,
      meetingId,
      minuteToken,
      imported: 0,
      updated: 0,
      skipped: 0,
      error: describeFeishuServerError(tr.error),
    };
  }

  // Step 3: reconcile
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const participants = await prisma.interviewParticipant.findMany({
    where: { interviewId },
    select: { feishuOpenId: true, displayName: true, role: true, roleSource: true },
  });
  const lines = tr.data.lines ?? [];
  for (const line of lines) {
    const text = (line.text ?? "").trim();
    if (!text) {
      skipped++;
      continue;
    }
    const sentenceId = line.sentence_id ?? undefined;
    const speakerName = line.speaker_name ?? line.speaker_id ?? "未知";
    const participant = participants.find((p) =>
      (line.speaker_id && p.feishuOpenId === line.speaker_id) || p.displayName === speakerName,
    );
    const occurredAt = line.start_time ? new Date(line.start_time) : new Date();

    if (sentenceId) {
      const existing = await prisma.transcriptLine.findUnique({
        where: {
          interviewId_sourceType_platformSentenceId: {
            interviewId,
            sourceType: "feishu_minutes",
            platformSentenceId: sentenceId,
          },
        },
      });
      if (existing) {
        if (existing.text !== text) {
          await prisma.transcriptLine.update({
            where: { id: existing.id },
            data: { text, revision: { increment: 1 } },
          });
          updated++;
        } else {
          skipped++;
        }
        continue;
      }
    }

    // Try to match with a live line that has same speaker+text+time
    const liveMatch = await prisma.transcriptLine.findFirst({
      where: {
        interviewId,
        sourceType: "feishu_live",
        speakerDisplayName: speakerName,
        text,
        occurredAt: {
          gte: new Date(occurredAt.getTime() - 5_000),
          lte: new Date(occurredAt.getTime() + 5_000),
        },
      },
    });

    if (liveMatch) {
      // Live already captured it; mark as confirmed by minutes source
      skipped++;
      continue;
    }

    const created = await prisma.transcriptLine.create({
      data: {
        interviewId,
        sourceType: "feishu_minutes",
        platformSentenceId: sentenceId,
        speakerDisplayName: speakerName,
        speakerPlatformId: line.speaker_id,
        text,
        occurredAt,
        speakerRole: participant?.role ?? "unknown",
        roleSource: participant?.roleSource ?? "unknown",
      },
    });
    publishEvent(interviewId, "transcript.line.upserted", created);
    imported++;
  }

  // Bump transcript revision
  await prisma.interview.update({
    where: { id: interviewId },
    data: { transcriptRevision: { increment: 1 } },
  });

  // Mark interview as ended
  await prisma.interview.update({
    where: { id: interviewId },
    data: { status: "ended" },
  });

  return {
    interviewId,
    meetingId,
    minuteToken,
    imported,
    updated,
    skipped,
  };
}

/**
 * Auto-trigger post-meeting reconciliation after a configurable grace period
 * (e.g. meeting scheduled end + 10 minutes).
 */
export async function schedulePostMeeting(interviewId: string, fireAt: Date): Promise<void> {
  const delay = Math.max(fireAt.getTime() - Date.now(), 0);
  setTimeout(async () => {
    try {
      const result = await reconcilePostMeeting(interviewId);
      console.log(`[post-meeting] ${interviewId}: ${result.imported} new, ${result.updated} updated, ${result.skipped} skipped`);
    } catch (e) {
      console.error(`[post-meeting] ${interviewId} failed: ${(e as Error).message}`);
    }
  }, delay);
}
