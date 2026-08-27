// ─── SYNC-002 台账状态映射 ───
// 将面试状态 + 面评结论 + 人工决定 → 台账建议状态
//
// 映射规则 (PRD §10.4 SYNC-002)：
//   面试进行中               → 面试中 (可自动，绑定确认后更新)
//   面评草稿完成              → 面试中 / 面评待确认 (新扩展中间状态)
//   人工确认进入下一轮          → 面试中 (是，记录下一轮待约)
//   人工确认进入 Offer 评估     → offer / Offer评估 (需人工确认)
//   AI 建议淘汰               → 待确认 (否，必须人工)
//   人工确认婉拒              → 已拒 (需独立对外动作确认)

import {
  InterviewStatus as IS,
  HumanDecision as HD,
  LedgerStatus as LS,
  ReviewStatus as RS,
} from "@vice/contracts";
import type { LedgerStatus, LedgerTransition } from "@vice/contracts";

// ─── 输入参数 ───
export interface LedgerMappingInput {
  interviewStatus: string;
  reviewStatus: string | null;        // ReviewDraft.reviewStatus
  suggestedDecision: string | null;   // AI 建议结论
  humanDecision: string | null;       // 人工审批结论
  isFinalRound: boolean;              // 是否终面（用于区分 next_round vs offer_evaluation）
  currentLedgerStatus: LedgerStatus | null; // 当前台账状态（变更检测用）
}

// ─── 输出 ───
export interface LedgerMappingOutput {
  status: LedgerStatus;
  autoEffective: boolean;             // 是否可自动生效
  label: string;
  transition: LedgerTransition | null; // 有变更时返回 transition，无变更返回 null
  note: string;                       // 人类可读的解释说明
}

// ─── 标签映射 ───
const LEDGER_LABELS: Record<LedgerStatus, string> = {
  [LS.NotSet]:             "未设置",
  [LS.InProgress]:         "面试中",
  [LS.EvaluationPending]:  "面评待确认",
  [LS.NextRound]:          "进入下一轮",
  [LS.OfferEvaluation]:    "Offer 评估",
  [LS.PendingConfirm]:     "待确认",
  [LS.Rejected]:           "已拒",
};

// ─── 面试进行中的状态集合 ───
const LIVE_INTERVIEW_STATUSES = new Set<string>([
  IS.Bound,
  IS.Capturing,
  IS.Live,
  IS.Ending,
  IS.Ended,
  IS.TranscriptFinalizing,
]);

// ─── 面评生成/草稿状态集合 ───
const REVIEW_DRAFT_STATUSES = new Set<string>([
  IS.ReviewGenerating,
  IS.ReviewDraft,
]);

// ─── 面评完成状态集合 ───
const REVIEW_COMPLETE_STATUSES = new Set<string>([
  IS.ReviewApproved,
  IS.Synced,
]);

// ─── 核心映射函数 ───
export function mapToLedgerStatus(input: LedgerMappingInput): LedgerMappingOutput {
  const { interviewStatus, reviewStatus, suggestedDecision, humanDecision, isFinalRound, currentLedgerStatus } = input;

  let status: LedgerStatus = LS.InProgress;
  let autoEffective = false;
  let note = "";

  // ── Rule 1: 面试进行中 → 面试中 ──
  if (LIVE_INTERVIEW_STATUSES.has(interviewStatus)) {
    status = LS.InProgress;
    autoEffective = true;
    note = "面试进行中，台账自动标记为「面试中」。绑定飞书会议后可实时更新。";
  }
  // ── Rule 2: 面评草稿完成（未审批） ──
  else if (REVIEW_DRAFT_STATUSES.has(interviewStatus)) {
    if (suggestedDecision === HD.Reject) {
      // AI 建议淘汰 → 待确认（不可自动）
      status = LS.PendingConfirm;
      autoEffective = false;
      note = "AI 建议淘汰，需人工确认后方可更新台账状态。";
    } else if (reviewStatus === RS.DraftReady || reviewStatus === RS.Editing || reviewStatus === RS.ApprovalPending) {
      // 草稿已完成但未审批 → 面评待确认
      status = LS.EvaluationPending;
      autoEffective = false;
      note = "面评草稿已完成，等待审批。审批后才会更新台账。";
    } else {
      // 面评生成中 → 仍为面试中
      status = LS.InProgress;
      autoEffective = true;
      note = "面评正在生成中，台账暂维持「面试中」。";
    }
  }
  // ── Rule 3-6: 面评已审批/已同步 ──
  else if (REVIEW_COMPLETE_STATUSES.has(interviewStatus)) {
    if (!humanDecision) {
      // 防御：已审批但没有人工决定 → 待确认
      status = LS.EvaluationPending;
      autoEffective = false;
      note = "面评已审批但缺少人工结论，请补充后更新台账。";
    } else if (humanDecision === HD.Pass) {
      if (isFinalRound) {
        // Pass + 终面 → Offer 评估
        status = LS.OfferEvaluation;
        autoEffective = false;
        note = "终面通过，建议进入 Offer 评估。需人工确认后方可推进。";
      } else {
        // Pass + 非终面 → 下一轮
        status = LS.NextRound;
        autoEffective = true;
        note = "面试通过，自动标记为「进入下一轮」。请及时安排下一轮面试。";
      }
    } else if (humanDecision === HD.Hold) {
      // Hold → 待确认
      status = LS.PendingConfirm;
      autoEffective = false;
      note = "人工标记为「待定」，需补充信息后再做决定。";
    } else if (humanDecision === HD.Reject) {
      // Reject → 已拒
      status = LS.Rejected;
      autoEffective = false;
      note = "面试不通过，台账标记为「已拒」。建议发送婉拒话术。";
    }
  }
  // ── Fallback: 其他状态（created, closed, cancelled 等） ──
  else {
    status = LS.InProgress;
    autoEffective = false;
    note = `面试状态为「${interviewStatus}」，台账暂维持「面试中」。`;
  }

  // ── 变更检测 ──
  const changed = currentLedgerStatus !== status;
  const transition: LedgerTransition | null = changed
    ? {
        from: currentLedgerStatus,
        to: status,
        source: autoEffective ? "auto" : "manual",
        reason: note,
        triggeredByInterviewStatus: interviewStatus,
        triggeredByHumanDecision: humanDecision,
        triggeredBySuggestedDecision: suggestedDecision,
        isFinalRound,
        timestamp: new Date().toISOString(),
      }
    : null;

  return {
    status,
    autoEffective,
    label: LEDGER_LABELS[status] || status,
    transition,
    note,
  };
}

// ─── 向前端暴露的简易接口（仅状态 + 标签，不含 transition） ───
export function computeLedgerStatus(input: LedgerMappingInput): LedgerStatus {
  return mapToLedgerStatus(input).status;
}

// ─── 状态变更是否生效（需人工确认） ───
export function isLedgerAutoEffective(input: LedgerMappingInput): boolean {
  return mapToLedgerStatus(input).autoEffective;
}

// ─── 台账状态标签 ───
export function getLedgerLabel(status: LedgerStatus): string {
  return LEDGER_LABELS[status] || status;
}
