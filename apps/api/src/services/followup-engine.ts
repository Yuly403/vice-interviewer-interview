/**
 * Followup engine — consumes transcript events, batches into sliding windows,
 * asks DeepSeek for follow-up suggestions, persists as LiveSuggestion,
 * publishes SSE.
 *
 * Design:
 *   - One engine instance per interview (lifecycle: tied to plan confirmation)
 *   - Buffer of unprocessed transcript line ids
 *   - Tick every 20s: take all lines since last tick, ask LLM
 *   - Max one LLM call per interview per tick to control cost
 *   - Dedup: if the same observation is generated twice, drop the duplicate
 */

import { prisma } from "../db.js";
import { publishEvent } from "../routes/sse.js";
import { chat, buildFollowupGenPrompt, parseFollowupGenOutput, type LlmConfig } from "@vice/llm";
import type { LiveSuggestion, SuggestionKind } from "@vice/contracts";
import { classifyLlmFailure } from "./plan-generation.js";

// ---- config -----------------------------------------------------------------

const TICK_MS = 20_000;
const MIN_LINES_PER_TICK = 4;
const SUGGESTION_TTL_MS = 5 * 60_000; // 5 min
const MAX_SUGGESTIONS_PER_TICK = 3;
const MAX_PENDING_LINES = 200;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

// ---- engine state -----------------------------------------------------------

interface EngineState {
  interviewId: string;
  timer: NodeJS.Timeout | null;
  lastLineId: string | null;
  lastOccurredAt: Date | null;
  pendingLines: any[];
  stopped: boolean;
  recentObservationHashes: string[]; // for dedup
  generation: number;
  consecutiveFailures: number;
}

const engines = new Map<string, EngineState>();
const MAX_RECENT_HASHES = 50;

const LLM_CONFIG: LlmConfig = {
  baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://llm-gateway.example.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  model: MODEL,
  temperature: 0.2,
  timeoutSec: 30,
};

// ---- public API -------------------------------------------------------------

/**
 * Start the engine for an interview.
 * Engine watches new transcript lines and emits follow-up suggestions.
 */
export function startFollowupEngine(interviewId: string): void {
  if (engines.has(interviewId)) return;

  // Set initial cursor to "current latest line" so we don't backfill
  prisma.transcriptLine
    .findFirst({
      where: { interviewId, isDeleted: false },
      orderBy: { occurredAt: "desc" },
      select: { id: true, occurredAt: true },
    })
    .then((latest) => {
      const state: EngineState = {
        interviewId,
        timer: null,
        lastLineId: latest?.id ?? null,
        lastOccurredAt: latest?.occurredAt ?? null,
        pendingLines: [],
        stopped: false,
        recentObservationHashes: [],
        generation: 1,
        consecutiveFailures: 0,
      };
      engines.set(interviewId, state);
      console.log(`[followup] engine started for ${interviewId}`);
      scheduleTick(state);
    })
    .catch((e) => {
      console.error(`[followup] failed to start for ${interviewId}: ${e.message}`);
    });
}

export function stopFollowupEngine(interviewId: string): void {
  const s = engines.get(interviewId);
  if (!s) return;
  s.stopped = true;
  if (s.timer) clearTimeout(s.timer);
  engines.delete(interviewId);
  console.log(`[followup] engine stopped for ${interviewId}`);
}

export function isFollowupRunning(interviewId: string): boolean {
  return engines.has(interviewId);
}

export async function resumeAllFollowupEngines(): Promise<void> {
  // Start engines for any interview with an active plan
  const withPlan = await prisma.interview.findMany({
    where: {
      status: { in: ["bound", "capturing", "live"] },
      plan: { is: { confirmedAt: { not: null } } },
    },
    select: { id: true },
  });
  for (const iv of withPlan) {
    startFollowupEngine(iv.id);
  }
  const activeIds = new Set(withPlan.map((interview) => interview.id));
  for (const interviewId of engines.keys()) {
    if (!activeIds.has(interviewId)) stopFollowupEngine(interviewId);
  }
  console.log(`[followup] resumed ${withPlan.length} engines`);
}

// ---- tick -------------------------------------------------------------------

function scheduleTick(state: EngineState) {
  if (state.stopped || state.timer) return;
  const delay = state.consecutiveFailures > 0
    ? Math.min(TICK_MS * (2 ** state.consecutiveFailures), MAX_RETRY_DELAY_MS)
    : TICK_MS;
  state.timer = setTimeout(async () => {
    state.timer = null;
    try {
      await tick(state);
    } catch (error) {
      state.consecutiveFailures += 1;
      console.error(`[followup] tick error ${state.interviewId}: ${(error as Error).message}`);
    } finally {
      scheduleTick(state);
    }
  }, delay);
}

async function tick(state: EngineState) {
  if (state.stopped) return;

  // A UUID is not a chronological cursor. Use (occurredAt, id) ordering and
  // retain low-volume lines until there is enough context for one LLM turn.
  const fetched = await prisma.transcriptLine.findMany({
    where: {
      interviewId: state.interviewId,
      isDeleted: false,
      ...(state.lastOccurredAt
        ? { occurredAt: { gte: state.lastOccurredAt } }
        : {}),
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: 80,
  });
  const lines = fetched.filter((line) => {
    if (!state.lastOccurredAt) return true;
    const time = line.occurredAt.getTime();
    const cursor = state.lastOccurredAt.getTime();
    return time > cursor || (time === cursor && (!state.lastLineId || line.id > state.lastLineId));
  });
  if (lines.length) {
    const newest = lines[lines.length - 1];
    state.lastLineId = newest.id;
    state.lastOccurredAt = newest.occurredAt;
    state.pendingLines.push(...lines);
    if (state.pendingLines.length > MAX_PENDING_LINES) {
      const dropped = state.pendingLines.length - MAX_PENDING_LINES;
      state.pendingLines.splice(0, dropped);
      console.warn(`[followup] dropped ${dropped} oldest pending lines for ${state.interviewId} after reaching the bounded queue limit`);
    }
  }

  if (state.pendingLines.length < MIN_LINES_PER_TICK) {
    return;
  }

  const batch = state.pendingLines.splice(0, 40);
  try {
    await generateSuggestions(state, batch);
    state.consecutiveFailures = 0;
  } catch (e) {
    // Preserve the batch on transient/model failure; it has not been processed.
    state.pendingLines.unshift(...batch);
    state.consecutiveFailures += 1;
    console.error(`[followup] generation error for ${state.interviewId}: ${(e as Error).message}`);
  }
}

async function generateSuggestions(state: EngineState, lines: any[]) {
  if (!LLM_CONFIG.apiKey) {
    console.warn("[followup] DEEPSEEK_API_KEY not set, skipping");
    return;
  }

  // Load interview context
  const iv = await prisma.interview.findUnique({
    where: { id: state.interviewId },
    include: { plan: { include: { topics: { include: { criteria: true }, orderBy: { sortOrder: "asc" } } } } },
  });
  if (!iv?.plan) return;

  const messages = buildFollowupGenPrompt({
    topics: iv.plan.topics.map((topic) => ({
      title: topic.title,
      status: topic.status,
      criteria: topic.criteria.map((criterion) => criterion.text),
    })),
    transcript: lines.map((line) => ({
      occurredAt: line.occurredAt.toISOString(),
      speakerDisplayName: line.speakerDisplayName,
      text: line.text,
    })),
    maxSuggestions: MAX_SUGGESTIONS_PER_TICK,
  });

  const result = await chat(LLM_CONFIG, messages, 1_200);

  if (!result.content) return;

  let parsed;
  try {
    parsed = parseFollowupGenOutput(result.content);
  } catch (error) {
    console.warn(`[followup] LLM output rejected for interview ${state.interviewId}; reason=${classifyLlmFailure(error)}`);
    return;
  }

  const suggestions = parsed.suggestions.slice(0, MAX_SUGGESTIONS_PER_TICK);
  for (const s of suggestions) {
    const obs = s.observation.trim();
    const hash = simpleHash(obs.toLowerCase());
    if (state.recentObservationHashes.includes(hash)) continue;
    state.recentObservationHashes.push(hash);
    if (state.recentObservationHashes.length > MAX_RECENT_HASHES) {
      state.recentObservationHashes = state.recentObservationHashes.slice(-MAX_RECENT_HASHES);
    }

    // Map topic title to topicId
    const topicTitle = s.topicTitle?.trim();
    const topic = topicTitle
      ? iv.plan.topics.find((t) => t.title.includes(topicTitle) || t.title === topicTitle)
      : undefined;

    const kind = normalizeKind(s.kind);
    const confidence = typeof s.confidence === "number" ? Math.max(0, Math.min(1, s.confidence)) : 0.5;

    const created = await prisma.liveSuggestion.create({
      data: {
        interviewId: state.interviewId,
        kind,
        topicId: topic?.id,
        observation: obs,
        suggestedQuestion: s.suggestedQuestion?.trim() || null,
        evidenceLineIds: JSON.stringify(lines.map((l) => l.id)),
        confidence,
        generation: state.generation,
        expiresAt: new Date(Date.now() + SUGGESTION_TTL_MS),
      },
    });

    const dto: LiveSuggestion = {
      id: created.id,
      interviewId: created.interviewId,
      kind: created.kind as SuggestionKind,
      topicId: created.topicId ?? undefined,
      observation: created.observation,
      suggestedQuestion: created.suggestedQuestion ?? undefined,
      evidenceLineIds: JSON.parse(created.evidenceLineIds),
      confidence: created.confidence,
      generation: created.generation,
      expiresAt: created.expiresAt.toISOString(),
    };
    publishEvent(state.interviewId, "live.suggestion.created", dto);
  }

  state.generation++;
}

function normalizeKind(raw: any): string {
  const k = String(raw ?? "").toLowerCase().trim();
  if (k === "followup_question" || k.includes("follow")) return "followup_question";
  if (k === "missing_evidence" || k.includes("red") || k.includes("risk") || k.includes("flag") || k.includes("missing")) return "missing_evidence";
  if (k === "topic_uncovered" || k.includes("cover") || k.includes("topic")) return "topic_uncovered";
  if (k === "clarify_scope" || k.includes("scope") || k.includes("范围")) return "clarify_scope";
  if (k === "clarify_metric" || k.includes("metric") || k.includes("指标") || k.includes("量化")) return "clarify_metric";
  if (k === "time_check" || k.includes("time") || k.includes("时间")) return "time_check";
  return "followup_question";
}

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}
