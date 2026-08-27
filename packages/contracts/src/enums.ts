// ─── Interview States ───
export const InterviewStatus = {
  Created: "created",
  PackageImported: "package_imported",
  PlanGenerating: "plan_generating",
  PlanDraft: "plan_draft",
  Ready: "ready",
  Binding: "binding",
  Bound: "bound",
  Capturing: "capturing",
  Live: "live",
  Ending: "ending",
  CaptureFailed: "capture_failed",
  Ended: "ended",
  TranscriptFinalizing: "transcript_finalizing",
  ReviewGenerating: "review_generating",
  ReviewDraft: "review_draft",
  ReviewApproved: "review_approved",
  Synced: "synced",
  Closed: "closed",
  AttentionRequired: "attention_required",
  Cancelled: "cancelled",
} as const;

export type InterviewStatus = (typeof InterviewStatus)[keyof typeof InterviewStatus];

// ─── Topic Status ───
export const TopicStatus = {
  Unasked: "unasked",
  Started: "started",
  EvidencePartial: "evidence_partial",
  NeedsFollowup: "needs_followup",
  Covered: "covered",
  SkippedByHuman: "skipped_by_human",
  NotApplicable: "not_applicable",
} as const;

export type TopicStatus = (typeof TopicStatus)[keyof typeof TopicStatus];

// ─── Criterion Status ───
export const CriterionResult = {
  Missing: "missing",
  Partial: "partial",
  Supported: "supported",
} as const;

export type CriterionResult = (typeof CriterionResult)[keyof typeof CriterionResult];

// ─── Speaker Role ───
export const SpeakerRole = {
  Interviewer: "interviewer",
  Candidate: "candidate",
  Unknown: "unknown",
} as const;

export type SpeakerRole = (typeof SpeakerRole)[keyof typeof SpeakerRole];

export const RoleSource = {
  User: "user",
  Schedule: "schedule",
  Platform: "platform",
  Ai: "ai",
  Unknown: "unknown",
} as const;

export type RoleSource = (typeof RoleSource)[keyof typeof RoleSource];

// ─── Review Content Type ───
export const ContentType = {
  Fact: "fact",
  Inference: "inference",
  OpenQuestion: "open_question",
  HumanDecision: "human_decision",
} as const;

export type ContentType = (typeof ContentType)[keyof typeof ContentType];

// ─── Human Decision ───
export const HumanDecision = {
  Pass: "pass",
  Hold: "hold",
  Reject: "reject",
} as const;

export type HumanDecision = (typeof HumanDecision)[keyof typeof HumanDecision];

// ─── Suggestion Kind ───
export const SuggestionKind = {
  MissingEvidence: "missing_evidence",
  ClarifyScope: "clarify_scope",
  ClarifyMetric: "clarify_metric",
  FollowupQuestion: "followup_question",
  TopicUncovered: "topic_uncovered",
  TimeCheck: "time_check",
} as const;

export type SuggestionKind = (typeof SuggestionKind)[keyof typeof SuggestionKind];

// ─── Transcript Source ───
export const TranscriptSource = {
  Live: "live",
  FeishuLive: "feishu_live",
  Document: "document",
  Minutes: "minutes",
  FeishuMinutes: "feishu_minutes",
  Manual: "manual",
} as const;

export type TranscriptSource = (typeof TranscriptSource)[keyof typeof TranscriptSource];

// ─── Review Status ───
// 面评生命周期子状态机（PRD §10.4），与 InterviewStatus 中 review_* / synced 建立映射
export const ReviewStatus = {
  NotStarted: "not_started",
  Generating: "generating",
  ValidationFailed: "validation_failed",
  DraftReady: "draft_ready",
  Editing: "editing",
  ApprovalPending: "approval_pending",
  Approved: "approved",
  SyncPending: "sync_pending",
  Synced: "synced",
  SyncConflict: "sync_conflict",
} as const;

export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

// ─── Sync Conflict Type ───
// 工作区回写冲突类型（PRD SYNC-003）
export const ConflictType = {
  StaleLine: "stale_line",
  DecisionMismatch: "decision_mismatch",
  MissingField: "missing_field",
} as const;

export type ConflictType = (typeof ConflictType)[keyof typeof ConflictType];

// ─── Ledger Status ───
// 台账建议状态（PRD SYNC-002），由面试状态 + 面评结论 + 人工决定映射得出
export const LedgerStatus = {
  NotSet: "not_set",
  InProgress: "in_progress",         // 面试中
  EvaluationPending: "evaluation_pending", // 面评待确认
  NextRound: "next_round",           // 进入下一轮
  OfferEvaluation: "offer_evaluation", // Offer 评估
  PendingConfirm: "pending_confirm", // 待确认（AI建议淘汰，等人工）
  Rejected: "rejected",              // 已拒
} as const;

export type LedgerStatus = (typeof LedgerStatus)[keyof typeof LedgerStatus];

// ─── Ledger Transition Record ───
// 审计台账状态变更的元数据
export interface LedgerTransition {
  from: LedgerStatus | null;
  to: LedgerStatus;
  source: "auto" | "manual";
  reason: string;
  triggeredByInterviewStatus: string;
  triggeredByHumanDecision: string | null;
  triggeredBySuggestedDecision: string | null;
  isFinalRound: boolean;
  timestamp: string;
}

// ─── User Role ───
export const UserRole = {
  Recruiter: "recruiter",
  Interviewer: "interviewer",
  HiringManager: "hiring_manager",
  Admin: "admin",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];
