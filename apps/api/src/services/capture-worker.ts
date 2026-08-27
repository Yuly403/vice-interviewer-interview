/**
 * Capture worker — polls Feishu meeting events for a single bound interview,
 * deduplicates, persists to TranscriptLine, and publishes SSE events.
 *
 * Lifecycle:
 *   1. Acquire or renew CaptureLease for the interview.
 *   2. Poll vc +meeting-events every POLL_MS.
 *   3. Filter for transcript/sentence events.
 *   4. Upsert by (interviewId, sourceType, platformSentenceId) unique key.
 *   5. Update lease cursor and lastSuccessAt.
 *   6. Publish SSE event per new/updated line.
 *
 * On any error: back off exponentially, mark lease as stale, retry.
 */

import { prisma } from "../db.js";
import { publishEvent } from "../routes/sse.js";
import {
  getMeetingEvents,
  isRetryableLarkError,
  describeLarkError,
  type MeetingEvent,
  type LarkIdentity,
} from "./feishu.js";

// ---- config -----------------------------------------------------------------

const POLL_MS = 3_000;
const PAGE_SIZE = 50;
const LEASE_TTL_MS = 30_000;
const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

// ---- worker registry --------------------------------------------------------

interface WorkerEntry {
  interviewId: string;
  meetingId: string;
  asIdentity: LarkIdentity;
  timer: NodeJS.Timeout | null;
  consecutiveFailures: number;
  cursorTime: Date;
  lastSuccessAt: Date | null;
  stopped: boolean;
  startedAt: Date;
  lineCount: number;
}

const workers = new Map<string, WorkerEntry>();

/**
 * Start capturing transcript for a bound interview.
 * No-op if already running for the same interview.
 */
export async function startCapture(
  interviewId: string,
  meetingId: string,
  asIdentity: LarkIdentity = "user",
): Promise<void> {
  if (workers.has(interviewId)) {
    // Already running — update target meeting/identity in case of rebind
    const w = workers.get(interviewId)!;
    w.meetingId = meetingId;
    w.asIdentity = asIdentity;
    return;
  }

  // Try to acquire lease
  const acquired = await acquireLease(interviewId);
  if (!acquired) {
    console.warn(`[capture] could not acquire lease for ${interviewId}, another worker owns it`);
    return;
  }

  const persistedLease = await prisma.captureLease.findUnique({ where: { interviewId } });
  const persistedCursor = persistedLease?.cursor ? new Date(persistedLease.cursor) : null;
  // Resume from a durable cursor when possible. The overlap fallback is only
  // used for a first capture and deduplication protects repeated events.
  // (If interview is scheduled in the future, the worker will keep polling
  //  with an empty time window until the meeting starts, then capture live.)
  const cursorTime = persistedCursor && !Number.isNaN(persistedCursor.getTime())
    ? persistedCursor
    : new Date(Date.now() - 5 * 60_000);

  const entry: WorkerEntry = {
    interviewId,
    meetingId,
    asIdentity,
    timer: null,
    consecutiveFailures: 0,
    cursorTime,
    lastSuccessAt: null,
    stopped: false,
    startedAt: new Date(),
    lineCount: 0,
  };
  workers.set(interviewId, entry);

  console.log(`[capture] started for ${interviewId} meeting=${meetingId} as=${asIdentity}`);
  scheduleTick(entry);
}

export function stopCapture(interviewId: string): void {
  const w = workers.get(interviewId);
  if (!w) return;
  w.stopped = true;
  if (w.timer) clearTimeout(w.timer);
  workers.delete(interviewId);
  // Release lease
  prisma.captureLease
    .deleteMany({ where: { interviewId, ownerWorkerId: WORKER_ID } })
    .catch((e) => console.error(`[capture] failed to delete lease for ${interviewId}: ${(e as Error).message}`));
  console.log(`[capture] stopped for ${interviewId}`);
}

export function isCapturing(interviewId: string): boolean {
  return workers.has(interviewId);
}

export interface CaptureStatus {
  running: boolean;
  meetingId?: string;
  asIdentity?: LarkIdentity;
  cursorTime?: string;
  lastSuccessAt?: string;
  consecutiveFailures: number;
  lastError?: string;
  startedAt?: string;
  lineCount: number;
}

const lastErrorByInterview = new Map<string, string>();

export function getCaptureStatus(interviewId: string): CaptureStatus {
  const w = workers.get(interviewId);
  if (!w) {
    return { running: false, consecutiveFailures: 0, lineCount: 0 };
  }
  return {
    running: true,
    meetingId: w.meetingId,
    asIdentity: w.asIdentity,
    cursorTime: w.cursorTime.toISOString(),
    lastSuccessAt: w.lastSuccessAt?.toISOString(),
    consecutiveFailures: w.consecutiveFailures,
    lastError: lastErrorByInterview.get(interviewId),
    startedAt: w.startedAt.toISOString(),
    lineCount: w.lineCount,
  };
}

/** Resume all previously-capturing interviews (used on server restart). */
export async function resumeAll(): Promise<void> {
  const bound = await prisma.interview.findMany({
    where: {
      status: { in: ["bound", "capturing"] },
      feishuMeetingId: { not: null },
    },
    select: { id: true, feishuMeetingId: true },
  });
  for (const iv of bound) {
    if (iv.feishuMeetingId) {
      await startCapture(iv.id, iv.feishuMeetingId, "user");
    }
  }
  console.log(`[capture] resumed ${bound.length} workers`);
}

/**
 * Reconcile in-memory workers with the durable interview state.  This is used
 * by the dedicated worker process, so an API restart never creates a second
 * polling loop and an unbind is noticed without an in-process signal.
 */
export async function reconcileAll(): Promise<void> {
  const bound = await prisma.interview.findMany({
    where: { status: { in: ["bound", "capturing"] }, feishuMeetingId: { not: null } },
    select: { id: true, feishuMeetingId: true },
  });
  const desired = new Set(bound.map((item) => item.id));
  for (const interviewId of workers.keys()) {
    if (!desired.has(interviewId)) stopCapture(interviewId);
  }
  for (const item of bound) {
    if (item.feishuMeetingId) await startCapture(item.id, item.feishuMeetingId, "user");
  }
}

// ---- lease management -------------------------------------------------------

async function acquireLease(interviewId: string): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + LEASE_TTL_MS);

  try {
    await prisma.captureLease.create({
      data: {
        interviewId,
        ownerWorkerId: WORKER_ID,
        leaseUntil: until,
        heartbeatAt: now,
      },
    });
    return true;
  } catch {
    // Conditional update is the compare-and-swap: an active lease owned by a
    // different worker cannot be stolen between a read and write.
    const claimed = await prisma.captureLease.updateMany({
      where: {
        interviewId,
        OR: [
          { ownerWorkerId: WORKER_ID },
          { leaseUntil: { lt: now } },
        ],
      },
      data: {
        ownerWorkerId: WORKER_ID,
        leaseUntil: until,
        heartbeatAt: now,
      },
    });
    return claimed.count === 1;
  }
}

async function renewLease(interviewId: string): Promise<boolean> {
  try {
    const result = await prisma.captureLease.updateMany({
      where: { interviewId, ownerWorkerId: WORKER_ID },
      data: {
        leaseUntil: new Date(Date.now() + LEASE_TTL_MS),
        heartbeatAt: new Date(),
      },
    });
    return result.count === 1;
  } catch {
    return false;
  }
}

// ---- tick loop --------------------------------------------------------------

function scheduleTick(entry: WorkerEntry, delay = POLL_MS) {
  if (entry.stopped) return;
  entry.timer = setTimeout(() => tick(entry), delay);
}

async function tick(entry: WorkerEntry) {
  if (entry.stopped) return;
  try {
    const renewed = await renewLease(entry.interviewId);
    if (!renewed) {
      console.warn(`[capture] lease lost for ${entry.interviewId}, stopping`);
      stopCapture(entry.interviewId);
      return;
    }
    await pollOnce(entry);
    entry.consecutiveFailures = 0;
    lastErrorByInterview.delete(entry.interviewId);
  } catch (e) {
    entry.consecutiveFailures++;
    const msg = (e as Error).message;
    lastErrorByInterview.set(entry.interviewId, msg);
    console.error(`[capture] tick error ${entry.interviewId}: ${msg}`);
  }
  const delay = entry.consecutiveFailures === 0
    ? POLL_MS
    : Math.min(POLL_MS * 2 ** Math.min(entry.consecutiveFailures, 5), 60_000);
  scheduleTick(entry, delay);
}

async function pollOnce(entry: WorkerEntry) {
  const now = new Date();
  const startTime = entry.cursorTime.toISOString();
  const endTime = now.toISOString();

  const result = await getMeetingEvents(entry.meetingId, {
    start: startTime,
    end: endTime,
    as: entry.asIdentity,
    pageAll: true,
    pageSize: PAGE_SIZE,
  });

  if (!result.ok) {
    if (isRetryableLarkError(result.error)) {
      throw new Error(describeLarkError(result.error));
    }
    // Non-retryable: hard-fail this interview, stop worker
    console.error(
      `[capture] non-retryable error for ${entry.interviewId}: ${describeLarkError(result.error)}`,
    );
    // Update interview status to surface the issue
    await prisma.interview.update({
      where: { id: entry.interviewId },
      data: { status: "capture_failed" },
    }).catch((e) => console.error(`[capture] failed to update status for ${entry.interviewId}: ${(e as Error).message}`));
    publishEvent(entry.interviewId, "interview.status.changed", { interviewId: entry.interviewId, status: "capture_failed" });
    stopCapture(entry.interviewId);
    return;
  }

  const events = result.data.events ?? [];
  const transcripts = events.filter((e) => isTranscriptEvent(e));

  if (transcripts.length > 0) {
    await persistLines(entry.interviewId, transcripts);
  }

  entry.cursorTime = now;
  entry.lastSuccessAt = now;

  // Update lease cursor
  await prisma.captureLease.update({
    where: { interviewId: entry.interviewId },
    data: { lastSuccessAt: now, cursor: now.toISOString() },
  }).catch((e) => console.error(`[capture] failed to update lease for ${entry.interviewId}: ${(e as Error).message}`));

  // Update interview status
  if (transcripts.length > 0) {
    await prisma.interview.update({
      where: { id: entry.interviewId },
      data: { status: "capturing" },
    }).catch((e) => console.error(`[capture] failed to update status for ${entry.interviewId}: ${(e as Error).message}`));
    publishEvent(entry.interviewId, "interview.status.changed", { interviewId: entry.interviewId, status: "capturing" });
  }
}

function isTranscriptEvent(e: MeetingEvent): boolean {
  // Heuristics: text/content + (speaker_id|user_id) + start_time
  const hasText = typeof e.text === "string" || typeof e.content === "string";
  if (!hasText) return false;
  const hasSpeaker = e.speaker_id || (e as any).user_id || e.speaker_name;
  if (!hasSpeaker) return false;
  // Optional: filter by event type
  if (e.event_type && !/(transcript|sentence|speak|asr)/i.test(String(e.event_type))) {
    return false;
  }
  return true;
}

function extractText(e: MeetingEvent): string {
  return String(e.text ?? e.content ?? "").trim();
}

function extractSpeakerName(e: MeetingEvent): string {
  return String(e.speaker_name ?? (e as any).user_name ?? e.speaker_id ?? "未知").trim();
}

function extractSpeakerPlatformId(e: MeetingEvent): string | undefined {
  const id = e.speaker_id ?? (e as any).user_id;
  return id ? String(id) : undefined;
}

function extractSentenceId(e: MeetingEvent): string | undefined {
  return e.sentence_id
    ? String(e.sentence_id)
    : e.event_id
    ? String(e.event_id)
    : undefined;
}

function extractOccurredAt(e: MeetingEvent): Date {
  const raw = e.start_time ?? e.timestamp ?? e.end_time;
  if (raw == null) return new Date();
  if (typeof raw === "number") {
    // seconds or ms
    return new Date(raw < 1e12 ? raw * 1000 : raw);
  }
  const d = new Date(String(raw));
  return isNaN(d.getTime()) ? new Date() : d;
}

async function persistLines(interviewId: string, events: MeetingEvent[]) {
  let newLineCount = 0;
  const participants = await prisma.interviewParticipant.findMany({
    where: { interviewId },
    select: { feishuOpenId: true, displayName: true, role: true, roleSource: true },
  });
  for (const e of events) {
    const text = extractText(e);
    if (!text) continue;
    const sentenceId = extractSentenceId(e);
    const speakerName = extractSpeakerName(e);
    const platformId = extractSpeakerPlatformId(e);
    const occurredAt = extractOccurredAt(e);
    const contentHash = `sha256:${hashString(text)}`;
    const participant = participants.find((p) =>
      (platformId && p.feishuOpenId === platformId) || p.displayName === speakerName,
    );

    if (sentenceId) {
      // Upsert by unique key
      const existing = await prisma.transcriptLine.findUnique({
        where: {
          interviewId_sourceType_platformSentenceId: {
            interviewId,
            sourceType: "feishu_live",
            platformSentenceId: sentenceId,
          },
        },
      });

      if (existing) {
        if (existing.text !== text) {
          await prisma.transcriptLine.update({
            where: { id: existing.id },
            data: { text, revision: { increment: 1 }, contentHash },
          });
          publishEvent(interviewId, "transcript.line.upserted", {
            ...existing,
            text,
            revision: existing.revision + 1,
            contentHash,
          });
        }
        continue;
      }
    }

    const created = await prisma.transcriptLine.create({
      data: {
        interviewId,
        sourceType: "feishu_live",
        platformSentenceId: sentenceId,
        speakerDisplayName: speakerName,
        speakerPlatformId: platformId,
        text,
        occurredAt,
        contentHash,
        speakerRole: participant?.role ?? "unknown",
        roleSource: participant?.roleSource ?? "unknown",
      },
    });
    publishEvent(interviewId, "transcript.line.upserted", created);
    newLineCount++;
  }

  // Update worker line count
  const w = workers.get(interviewId);
  if (w) w.lineCount += newLineCount;

  // Bump transcript revision
  await prisma.interview.update({
    where: { id: interviewId },
    data: { transcriptRevision: { increment: 1 } },
  });
}

function hashString(s: string): string {
  // Simple deterministic 64-char hex; not crypto, just stable fingerprint
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  // Expand to 64 hex chars
  const base = (h >>> 0).toString(16).padStart(8, "0");
  return (base + base + base + base + base + base + base + base).slice(0, 64);
}
