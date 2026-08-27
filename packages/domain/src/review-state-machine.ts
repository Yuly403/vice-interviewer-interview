import { ReviewStatus, ReviewStatus as RS, ConflictType } from "@vice/contracts";

// ─── Review lifecycle transitions (PRD §10.4) ───
const REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  [RS.NotStarted]:       [RS.Generating],
  [RS.Generating]:       [RS.DraftReady, RS.ValidationFailed],
  [RS.ValidationFailed]: [RS.Generating, RS.DraftReady],
  [RS.DraftReady]:       [RS.Editing, RS.ApprovalPending],
  [RS.Editing]:          [RS.DraftReady, RS.ApprovalPending],
  [RS.ApprovalPending]:  [RS.Approved, RS.DraftReady],
  [RS.Approved]:         [RS.SyncPending],
  [RS.SyncPending]:      [RS.Synced, RS.SyncConflict],
  [RS.SyncConflict]:     [RS.SyncPending],
  [RS.Synced]:           [],
};

// ─── Guard interface ───
export interface ReviewTransitionGuards {
  /** 工作区回写无冲突或冲突已人工解决 */
  workspaceConflictsResolved?: boolean;
  /** evidence 引用的 transcript 行全部存在且未删除 */
  evidenceValidationPassed?: boolean;
  /** 审批人身份已确认（强身份认证） */
  strongIdentity?: boolean;
  /** 审批操作携带幂等键 */
  idempotencyKey?: boolean;
}

// ─── Conflict detail (SYNC-003) ───
export interface SyncConflict {
  type: ConflictType;
  fieldPath: string;
  localValue: unknown;
  remoteValue: unknown;
  message: string;
}

// ─── Updated interview status mapping ───
// 面试主状态机与面评子状态机的对应关系
export const REVIEW_TO_INTERVIEW_STATUS: Partial<Record<ReviewStatus, string>> = {
  [RS.Generating]:       "review_generating",
  [RS.DraftReady]:       "review_draft",
  [RS.Editing]:          "review_draft",
  [RS.ApprovalPending]:  "review_draft",
  [RS.Approved]:         "review_approved",
  [RS.SyncPending]:      "review_approved",
  [RS.Synced]:           "synced",
};

export function canTransitionReview(from: ReviewStatus, to: ReviewStatus): boolean {
  const allowed = REVIEW_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function transitionReview(
  current: ReviewStatus,
  to: ReviewStatus,
  guards: ReviewTransitionGuards = {}
): { ok: true; newStatus: ReviewStatus } | { ok: false; reason: string } {
  if (!canTransitionReview(current, to)) {
    return { ok: false, reason: `Cannot transition review from ${current} to ${to}` };
  }

  // Guard evaluation
  if (guards.workspaceConflictsResolved === false) {
    return { ok: false, reason: "Guard 'workspaceConflictsResolved' not satisfied: unresolved sync conflicts" };
  }
  if (guards.evidenceValidationPassed === false) {
    return { ok: false, reason: "Guard 'evidenceValidationPassed' not satisfied: evidence references invalid" };
  }
  if (guards.strongIdentity === false) {
    return { ok: false, reason: "Guard 'strongIdentity' not satisfied: approver identity not verified" };
  }
  if (guards.idempotencyKey === false) {
    return { ok: false, reason: "Guard 'idempotencyKey' not satisfied: missing idempotency key" };
  }

  return { ok: true, newStatus: to };
}

/** Get the interview status that corresponds to a given review status */
export function mapReviewToInterviewStatus(reviewStatus: ReviewStatus): string | undefined {
  return REVIEW_TO_INTERVIEW_STATUS[reviewStatus];
}

/** All review states considered terminal for the review lifecycle */
export function isReviewTerminal(status: ReviewStatus): boolean {
  return status === RS.Synced;
}

/** Whether the review is in an editable state */
export function isReviewEditable(status: ReviewStatus): boolean {
  return status === RS.DraftReady || status === RS.Editing;
}
