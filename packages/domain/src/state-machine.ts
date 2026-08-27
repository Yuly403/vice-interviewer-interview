import {
  InterviewStatus,
  InterviewStatus as IS,
} from "@vice/contracts";

// ─── Transition guard interface ───
// Guards are evaluated by name; any guard set to `false` blocks the transition.
export interface TransitionGuards {
  /** 工作区回写无冲突或冲突已人工解决（review_approved → synced 专用） */
  workspaceConflictsResolved?: boolean;
  /** HTML / text 内容结构校验通过 */
  structureValid?: boolean;
  /** 存在可用字幕或用户选择空面评 */
  transcriptAvailable?: boolean;
  /** 至少一名本轮面试官 */
  atLeastOneInterviewer?: boolean;
}

// ─── Allowed transitions ───
const TRANSITIONS: Record<InterviewStatus, InterviewStatus[]> = {
  [IS.Created]: [IS.PackageImported, IS.Cancelled],
  [IS.PackageImported]: [IS.PlanGenerating, IS.Cancelled],
  [IS.PlanGenerating]: [IS.PlanDraft, IS.AttentionRequired],
  [IS.PlanDraft]: [IS.Ready, IS.Cancelled, IS.AttentionRequired],
  [IS.Ready]: [IS.Binding, IS.Cancelled, IS.AttentionRequired],
  [IS.Binding]: [IS.Bound, IS.AttentionRequired],
  [IS.Bound]: [IS.Capturing, IS.Live, IS.AttentionRequired],
  [IS.Capturing]: [IS.Live, IS.CaptureFailed, IS.AttentionRequired],
  [IS.CaptureFailed]: [IS.Bound, IS.Cancelled, IS.AttentionRequired],
  [IS.Live]: [IS.Ending, IS.AttentionRequired],
  [IS.Ending]: [IS.Ended, IS.TranscriptFinalizing],
  [IS.Ended]: [IS.TranscriptFinalizing],
  [IS.TranscriptFinalizing]: [IS.ReviewGenerating],
  [IS.ReviewGenerating]: [IS.ReviewDraft, IS.AttentionRequired],
  [IS.ReviewDraft]: [IS.ReviewApproved, IS.AttentionRequired],
  [IS.ReviewApproved]: [IS.Synced],
  [IS.Synced]: [IS.Closed],
  [IS.Closed]: [],
  [IS.AttentionRequired]: [
    IS.Created, IS.PackageImported, IS.PlanDraft, IS.Ready,
    IS.Bound, IS.Live, IS.ReviewDraft,
  ],
  [IS.Cancelled]: [],
};

export function canTransition(from: InterviewStatus, to: InterviewStatus): boolean {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function transition(
  current: InterviewStatus,
  to: InterviewStatus,
  guards: TransitionGuards = {}
): { ok: true; newStatus: InterviewStatus } | { ok: false; reason: string } {
  if (!canTransition(current, to)) {
    return { ok: false, reason: `Cannot transition from ${current} to ${to}` };
  }

  // Evaluate typed guards — iterate with type safety
  const guardEntries: Array<[string, boolean | undefined]> = [
    ["workspaceConflictsResolved", guards.workspaceConflictsResolved],
    ["structureValid", guards.structureValid],
    ["transcriptAvailable", guards.transcriptAvailable],
    ["atLeastOneInterviewer", guards.atLeastOneInterviewer],
  ];

  for (const [name, passed] of guardEntries) {
    if (passed === false) {
      return { ok: false, reason: `Guard '${name}' not satisfied` };
    }
  }
  return { ok: true, newStatus: to };
}

/**
 * Transition review_approved → synced with workspace sync guard.
 * Convenience wrapper that enforces the workspaceConflictsResolved guard.
 */
export function transitionReviewApprovedToSynced(
  workspaceConflictsResolved: boolean
): { ok: true; newStatus: InterviewStatus } | { ok: false; reason: string } {
  return transition(IS.ReviewApproved, IS.Synced, {
    workspaceConflictsResolved,
  });
}

export function isTerminal(status: InterviewStatus): boolean {
  return status === IS.Closed || status === IS.Cancelled || status === IS.Ended;
}

export function isLive(status: InterviewStatus): boolean {
  return status === IS.Live || status === IS.Capturing;
}
