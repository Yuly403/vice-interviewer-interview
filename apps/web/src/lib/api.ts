/**
 * Typed API Layer — PRD 14.1
 *
 * - All requests carry Idempotency-Key and use the HttpOnly same-origin session
 * - Error responses parsed as { code, message, requestId, retryAfter? }
 * - AbortController support to avoid setState after unmount
 * - Token managed via external setter (from AuthContext)
 */

import type {
  InterviewPlan,
  InterviewPackage,
  InterviewResultPackage,
  ReviewDraft,
  TranscriptLine,
  Topic,
} from "@vice/contracts";

const BASE = "/api/v1";

/** @deprecated Sessions are HttpOnly cookies; retained as a compatibility no-op. */
export function setTokenGetter(_getter: () => string | null) {}

/** Called once when the server rejects a cookie session. */
let unauthorizedHandler: (() => void) | undefined;

export function setUnauthorizedHandler(handler?: () => void) {
  unauthorizedHandler = handler;
}

// ─── Error types ───

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
  retryAfter?: number;
}

export class ApiError extends Error {
  code: string;
  requestId?: string;
  retryAfter?: number;
  status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.code;
    this.requestId = body.requestId;
    this.retryAfter = body.retryAfter;
    this.status = status;
  }
}

// ─── Generic response wrapper ───

export interface ApiResponse<T> {
  data: T;
}

export type PlanGenerationMode = "llm" | "rule-based";

export interface PlanGenerationMeta {
  mode: PlanGenerationMode;
  model: string | null;
  promptVersion: string;
  durationMs: number;
  totalTokens?: number;
  fallbackReason?: "not_configured" | "timeout" | "api_error" | "invalid_json" | "invalid_schema" | "empty_output" | "unknown";
  generatedAt: string;
}

export type GeneratedInterviewPlan = InterviewPlan & {
  generation?: PlanGenerationMeta | null;
};

// ─── Core fetch ───

interface FetchOptions extends Omit<RequestInit, "signal"> {
  signal?: AbortSignal;
}

function createRequestId(): string {
  const browserCrypto = globalThis.crypto;
  if (browserCrypto && typeof browserCrypto.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function request<T>(
  url: string,
  options?: FetchOptions,
): Promise<ApiResponse<T>> {
  const idempotencyKey = createRequestId();
  const hasBody = options?.body !== undefined;

  const res = await fetch(`${BASE}${url}`, {
    ...options,
    credentials: options?.credentials ?? "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      "Idempotency-Key": idempotencyKey,
      ...options?.headers as Record<string, string>,
    },
  });

  if (!res.ok) {
    let body: ApiErrorBody;
    try {
      body = await res.json();
    } catch {
      body = { code: "UNKNOWN", message: `HTTP ${res.status}` };
    }
    const error = new ApiError(res.status, body);
    // A cookie session cannot be recovered by retrying the same request. Clear
    // the local user state so the route guard sends the user back to sign-in.
    if (res.status === 401) unauthorizedHandler?.();
    throw error;
  }

  return res.json();
}

// ─── Interview types ───

export interface InterviewSummary {
  id: string;
  status: string;
  roundType: string;
  scheduledAt: string;
  durationMinutes: number;
  feishuMeetingId: string | null;
  meetingBindingSource: string | null;
  participants: Array<{
    role: string;
    displayName: string;
  }>;
  createdAt: string;
}

export interface InterviewDetail extends InterviewSummary {
  job?: { title: string; jdText: string; internalCriteria: string[] };
  candidate?: { displayName: string; resumeText?: string };
  screening?: { strengths: string[]; verificationPoints: string[] };
  /** 台账状态 (SYNC-002) */
  ledgerStatus?: string;
  /** 台账流转记录 JSON 字符串 (SYNC-002) */
  ledgerTransitions?: string;
}

// ─── Feishu types ───

export interface MeetingSearchItem {
  id: string;
  display_info: string;
  meta_data: {
    app_link?: string;
    description?: string;
  };
}

export interface ActiveMeeting {
  meeting_id: string;
  topic: string;
  start_time?: string;
  end_time?: string;
  participant_count?: number;
}

export interface CaptureStatus {
  running: boolean;
  meetingId?: string;
  asIdentity?: string;
  cursorTime?: string;
  lastSuccessAt?: string;
  consecutiveFailures: number;
  lastError?: string;
  startedAt?: string;
  lineCount: number;
}

export interface PostMeetingResult {
  interviewId: string;
  meetingId: string;
  minuteToken: string | null;
  imported: number;
  updated: number;
  skipped: number;
  error?: string;
}

// ─── Sync types ───

export interface SyncConflictDetail {
  type: string;
  fieldPath: string;
  localValue: unknown;
  remoteValue: unknown;
  message: string;
}

export interface SyncResult {
  archivePath?: string;
  syncMeta?: Record<string, unknown>;
  status: "synced" | "sync_conflict";
  ledgerStatus?: string;
  ledgerLabel?: string;
  ledgerAutoEffective?: boolean;
  ledgerNote?: string;
  followupActions?: SyncAction[];
  followupSummary?: string;
  followupBreakdown?: Record<string, number>;
  primaryAction?: SyncAction;
  conflictTypes?: string[];
  conflictCount?: number;
  conflicts?: SyncConflictDetail[];
}

export interface SyncConflictsResponse {
  hasConflicts: boolean;
  conflicts: SyncConflictDetail[];
  count: number;
  status: string | null;
  revision: number;
}

export interface ResolveConflictsResponse {
  action: "retry" | "force" | "cancel";
  status: string;
}

export interface SyncAction {
  type: string;
  priority: string;
  title: string;
  description: string;
  targetRole: string;
  dependsOn: string[];
  autoTriggerable: boolean;
}

export interface SyncActionsResponse {
  available: boolean;
  actions: SyncAction[];
  summary: string;
  breakdown?: Record<string, number>;
  primaryAction?: SyncAction;
  context?: {
    humanDecision: string;
    isFinalRound: boolean;
    ledgerStatus: string;
    ledgerAutoEffective: boolean;
    openQuestionCount: number;
    uncoveredTopicCount: number;
  };
}

// ─── API ───

export const api = {
  // ── Interviews ──
  listInterviews: (signal?: AbortSignal) =>
    request<InterviewSummary[]>("/interviews", { signal }),

  getInterview: (id: string, signal?: AbortSignal) =>
    request<InterviewDetail>(`/interviews/${id}`, { signal }),

  importPackage: (data: InterviewPackage, signal?: AbortSignal) =>
    request<{ id: string }>("/interviews/import", {
      method: "POST",
      body: JSON.stringify(data),
      signal,
    }),

  // ── Feishu / Capture ──
  searchMeetings: (params: { start: string; end: string; query?: string; pageSize?: number }, signal?: AbortSignal) => {
    const qs = new URLSearchParams({
      start: params.start,
      end: params.end,
      ...(params.query ? { query: params.query } : {}),
      ...(params.pageSize ? { page_size: String(params.pageSize) } : {}),
    });
    return request<{ has_more?: boolean; items: MeetingSearchItem[]; page_token?: string }>(
      `/feishu/meetings/search?${qs}`,
      { signal },
    );
  },

  listActiveMeetings: (signal?: AbortSignal) =>
    request<ActiveMeeting[]>("/feishu/meetings/active", { signal }),

  bindMeetingV2: (id: string, meetingId: string, opts?: { autoStart?: boolean; confirmCandidateAndRound?: boolean }, signal?: AbortSignal) =>
    request<{ feishuMeetingId: string; status: string; captureStarted: boolean; captureError?: string }>(
      `/interviews/${id}/bind-meeting`,
      {
        method: "POST",
        body: JSON.stringify({ meetingId, autoStart: opts?.autoStart ?? true, confirmCandidateAndRound: opts?.confirmCandidateAndRound === true }),
        signal,
      },
    ),

  unbindMeeting: (id: string, signal?: AbortSignal) =>
    request<object>(`/interviews/${id}/unbind-meeting`, {
      method: "POST",
      signal,
    }),

  getCaptureStatus: (id: string, signal?: AbortSignal) =>
    request<CaptureStatus>(`/interviews/${id}/capture-status`, { signal }),

  restartCapture: (id: string, signal?: AbortSignal) =>
    request<CaptureStatus>(`/interviews/${id}/capture-restart`, {
      method: "POST",
      signal,
    }),

  reconcileMeeting: (id: string, signal?: AbortSignal) =>
    request<PostMeetingResult>(`/interviews/${id}/reconcile`, {
      method: "POST",
      body: JSON.stringify({}),
      signal,
    }),

  feedbackSuggestion: (id: string, suggestionId: string, feedback: string, signal?: AbortSignal) =>
    request<{ ok: boolean }>(`/interviews/${id}/suggestions/feedback`, {
      method: "POST",
      body: JSON.stringify({ suggestionId, feedback }),
      signal,
    }),

  // ── Plans ──
  getPlan: (id: string, signal?: AbortSignal) =>
    request<GeneratedInterviewPlan>(`/interviews/${id}/plan`, { signal }),

  generatePlan: (id: string, signal?: AbortSignal) =>
    request<GeneratedInterviewPlan>(`/interviews/${id}/plan/generate`, {
      method: "POST",
      signal,
    }),

  updatePlan: (id: string, topics: Topic[], expectedRevision: number, signal?: AbortSignal) =>
    request<InterviewPlan>(`/interviews/${id}/plan`, {
      method: "PATCH",
      body: JSON.stringify({ topics, expectedRevision }),
      signal,
    }),

  confirmPlan: (id: string, expectedRevision: number, signal?: AbortSignal) =>
    request<InterviewPlan>(`/interviews/${id}/plan/confirm`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision }),
      signal,
    }),

  // ── Transcripts ──
  getTranscript: (id: string, speaker?: string, signal?: AbortSignal) =>
    request<TranscriptLine[]>(
      `/interviews/${id}/transcript${speaker ? `?speaker=${speaker}` : ""}`,
      { signal },
    ),

  importTranscript: (id: string, lines: TranscriptLine[], signal?: AbortSignal) =>
    request<{ count: number }>(`/interviews/${id}/transcript/import`, {
      method: "POST",
      body: JSON.stringify({ lines }),
      signal,
    }),

  updateLine: (interviewId: string, lineId: string, data: Partial<TranscriptLine>, signal?: AbortSignal) =>
    request<TranscriptLine>(`/interviews/${interviewId}/transcript/lines/${lineId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
      signal,
    }),

  // ── Reviews ──
  getReview: (id: string, signal?: AbortSignal) =>
    request<ReviewDraft>(`/interviews/${id}/review`, { signal }),

  generateReview: (id: string, signal?: AbortSignal) =>
    request<ReviewDraft>(`/interviews/${id}/review/generate`, {
      method: "POST",
      signal,
    }),

  updateReview: (id: string, data: Pick<ReviewDraft, "overview" | "strengths" | "risks" | "nextRoundFocus">, signal?: AbortSignal) =>
    request<ReviewDraft>(`/interviews/${id}/review`, {
      method: "PATCH",
      body: JSON.stringify(data),
      signal,
    }),

  approveReview: (
    id: string,
    data: { humanDecision: string },
    signal?: AbortSignal,
  ) =>
    request<ReviewDraft>(`/interviews/${id}/review/approve`, {
      method: "POST",
      body: JSON.stringify(data),
      signal,
    }),

  exportReview: (id: string, signal?: AbortSignal) =>
    request<InterviewResultPackage>(`/interviews/${id}/review/export`, {
      signal,
    }),

  // ── SSE ──
  subscribeEvents: (
    id: string,
    onEvent: (event: string, data: unknown) => void,
    _token?: string,
  ): (() => void) => {
    // Same-origin EventSource sends the HttpOnly session cookie.  Never put a
    // bearer token in a URL where history, referrers and proxy logs can retain it.
    const source = new EventSource(`${BASE}/interviews/${id}/events`, { withCredentials: true });
    const handlers: Record<string, (e: MessageEvent) => void> = {};

    const eventTypes = [
      "transcript.line.upserted",
      "topic.coverage.updated",
      "live.suggestion.created",
      "interview.status.changed",
      "review.draft.ready",
    ];
    for (const et of eventTypes) {
      handlers[et] = (e: MessageEvent) => onEvent(et, JSON.parse(e.data));
      source.addEventListener(et, handlers[et]);
    }

    return () => {
      for (const et of eventTypes) {
        source.removeEventListener(et, handlers[et]);
      }
      source.close();
    };
  },

  // ── Sync (SYNC-001~004) ──
  /** 将已审批面评写入候选人档案 */
  syncReview: (id: string, signal?: AbortSignal) =>
    request<SyncResult>(`/interviews/${id}/review/sync`, {
      method: "POST",
      signal,
    }),

  /** 查询当前同步冲突 */
  getSyncConflicts: (id: string, signal?: AbortSignal) =>
    request<SyncConflictsResponse>(`/interviews/${id}/review/sync-conflicts`, {
      signal,
    }),

  /** 解决同步冲突 */
  resolveSyncConflicts: (
    id: string,
    action: "retry" | "force" | "cancel",
    signal?: AbortSignal,
  ) =>
    request<ResolveConflictsResponse>(
      `/interviews/${id}/review/sync-conflicts/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ action }),
        signal,
      },
    ),

  /** 获取后续动作建议 */
  getSyncActions: (id: string, signal?: AbortSignal) =>
    request<SyncActionsResponse>(`/interviews/${id}/review/sync-actions`, {
      signal,
    }),
};
