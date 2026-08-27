/**
 * 页面展示用映射表。
 *
 * 这里只做“业务文案 + 视觉颜色”的集中维护，不改变后端状态机。
 */

import { InterviewStatus, TopicStatus, ContentType, HumanDecision, LedgerStatus } from "@vice/contracts";

export const INTERVIEW_STATUS_MAP: Record<
  string,
  { label: string; color: string; textColor: string }
> = {
  [InterviewStatus.Created]: { label: "待准备", color: "var(--color-status-created)", textColor: "var(--color-gray-600)" },
  [InterviewStatus.PackageImported]: { label: "材料已导入", color: "var(--color-status-imported)", textColor: "var(--color-info-700)" },
  [InterviewStatus.PlanGenerating]: { label: "计划生成中", color: "var(--color-status-plan-generating)", textColor: "var(--color-warning-700)" },
  [InterviewStatus.PlanDraft]: { label: "计划草稿", color: "var(--color-status-plan-draft)", textColor: "var(--color-primary-800)" },
  [InterviewStatus.Ready]: { label: "待面试", color: "var(--color-status-ready)", textColor: "var(--color-success-700)" },
  [InterviewStatus.Binding]: { label: "绑定中", color: "var(--color-status-binding)", textColor: "var(--color-warning-700)" },
  [InterviewStatus.Bound]: { label: "已绑定会议", color: "var(--color-status-bound)", textColor: "var(--color-primary-800)" },
  [InterviewStatus.Capturing]: { label: "记录接入中", color: "var(--color-status-capturing)", textColor: "var(--color-info-700)" },
  [InterviewStatus.Live]: { label: "面试中", color: "var(--color-status-live)", textColor: "var(--color-pink-700)" },
  [InterviewStatus.CaptureFailed]: { label: "记录接入失败", color: "var(--color-danger-bg)", textColor: "var(--color-danger-700)" },
  [InterviewStatus.Ending]: { label: "结束中", color: "var(--color-status-ending)", textColor: "var(--color-warning-700)" },
  [InterviewStatus.Ended]: { label: "待生成面评", color: "var(--color-status-ended)", textColor: "var(--color-gray-600)" },
  [InterviewStatus.TranscriptFinalizing]: { label: "逐字稿处理中", color: "var(--color-status-transcript-finalizing)", textColor: "var(--color-warning-700)" },
  [InterviewStatus.ReviewGenerating]: { label: "面评生成中", color: "var(--color-status-review-generating)", textColor: "var(--color-warning-700)" },
  [InterviewStatus.ReviewDraft]: { label: "待确认面评", color: "var(--color-status-review-draft)", textColor: "var(--color-primary-800)" },
  [InterviewStatus.ReviewApproved]: { label: "面评已确认", color: "var(--color-status-review-approved)", textColor: "var(--color-success-700)" },
  [InterviewStatus.Synced]: { label: "已归档", color: "var(--color-status-synced)", textColor: "var(--color-success-700)" },
  [InterviewStatus.Closed]: { label: "已归档", color: "var(--color-status-closed)", textColor: "var(--color-gray-600)" },
  [InterviewStatus.AttentionRequired]: { label: "需关注", color: "var(--color-status-attention)", textColor: "var(--color-danger-700)" },
  [InterviewStatus.Cancelled]: { label: "已取消", color: "var(--color-status-cancelled)", textColor: "var(--color-gray-500)" },
};

export const TOPIC_STATUS_MAP: Record<
  string,
  { label: string; color: string }
> = {
  [TopicStatus.Unasked]: { label: "未聊", color: "var(--color-topic-unasked)" },
  [TopicStatus.Started]: { label: "进行中", color: "var(--color-topic-started)" },
  [TopicStatus.EvidencePartial]: { label: "证据不足", color: "var(--color-topic-evidence-partial)" },
  [TopicStatus.NeedsFollowup]: { label: "待追问", color: "var(--color-topic-needs-followup)" },
  [TopicStatus.Covered]: { label: "已覆盖", color: "var(--color-topic-covered)" },
  [TopicStatus.SkippedByHuman]: { label: "面试官跳过", color: "var(--color-topic-skipped)" },
  [TopicStatus.NotApplicable]: { label: "不适用", color: "var(--color-topic-na)" },
};

export const CONTENT_TYPE_MAP: Record<
  string,
  { label: string; bg: string; bar: string; textColor: string }
> = {
  [ContentType.Fact]: {
    label: "事实",
    bg: "var(--color-ctype-fact-bg)",
    bar: "var(--color-ctype-fact-bar)",
    textColor: "var(--color-ctype-fact-label)",
  },
  [ContentType.Inference]: {
    label: "AI 推断",
    bg: "var(--color-ctype-inference-bg)",
    bar: "var(--color-ctype-inference-bar)",
    textColor: "var(--color-ctype-inference-label)",
  },
  [ContentType.OpenQuestion]: {
    label: "待验证",
    bg: "var(--color-ctype-openq-bg)",
    bar: "var(--color-ctype-openq-bar)",
    textColor: "var(--color-ctype-openq-label)",
  },
  [ContentType.HumanDecision]: {
    label: "面试官判断",
    bg: "var(--color-ctype-human-bg)",
    bar: "var(--color-ctype-human-bar)",
    textColor: "var(--color-ctype-human-label)",
  },
};

export const DECISION_MAP: Record<
  string,
  { label: string; icon: string; color: string; textColor: string }
> = {
  [HumanDecision.Pass]: {
    label: "通过",
    icon: "\u2714",
    color: "var(--color-pass-bg)",
    textColor: "var(--color-pass-text)",
  },
  [HumanDecision.Hold]: {
    label: "待定",
    icon: "\u23F8",
    color: "var(--color-hold-bg)",
    textColor: "var(--color-hold-text)",
  },
  [HumanDecision.Reject]: {
    label: "淘汰",
    icon: "\u2718",
    color: "var(--color-reject-bg)",
    textColor: "var(--color-reject-text)",
  },
};

export const ROUND_LABELS: Record<string, string> = {
  first_round: "初面",
  second_round: "二面",
  third_round: "三面",
  final_round: "终面",
  hr_round: "HR 面",
};

export function getRoundLabel(round: string): string {
  return ROUND_LABELS[round] || round;
}

export const LEDGER_STATUS_MAP: Record<
  string,
  { label: string; color: string; textColor: string; description: string }
> = {
  [LedgerStatus.NotSet]: {
    label: "未设置",
    color: "var(--color-ledger-not-set)",
    textColor: "var(--color-gray-500)",
    description: "尚未进入台账流程",
  },
  [LedgerStatus.InProgress]: {
    label: "面试中",
    color: "var(--color-ledger-in-progress)",
    textColor: "var(--color-info-700)",
    description: "面试正在进行中",
  },
  [LedgerStatus.EvaluationPending]: {
    label: "待评估",
    color: "var(--color-ledger-evaluation-pending)",
    textColor: "var(--color-warning-700)",
    description: "面评已生成，等待评估",
  },
  [LedgerStatus.NextRound]: {
    label: "下一轮",
    color: "var(--color-ledger-next-round)",
    textColor: "var(--color-success-700)",
    description: "通过，进入下一轮面试",
  },
  [LedgerStatus.OfferEvaluation]: {
    label: "Offer 评估",
    color: "var(--color-ledger-offer-evaluation)",
    textColor: "var(--color-success-700)",
    description: "终面通过，进入 Offer 评估阶段",
  },
  [LedgerStatus.PendingConfirm]: {
    label: "待确认",
    color: "var(--color-ledger-pending-confirm)",
    textColor: "var(--color-warning-700)",
    description: "需要人工确认台账状态变更",
  },
  [LedgerStatus.Rejected]: {
    label: "已淘汰",
    color: "var(--color-ledger-rejected)",
    textColor: "var(--color-danger-700)",
    description: "面试未通过，流程终止",
  },
};

export function formatLedgerTransition(
  t: { from: string | null; to: string; source: string; reason: string; timestamp: string },
): string {
  const fromLabel = t.from ? LEDGER_STATUS_MAP[t.from]?.label || t.from : "初始";
  const toLabel = LEDGER_STATUS_MAP[t.to]?.label || t.to;
  const sourceLabel = t.source === "auto" ? "自动" : "手动";
  return `${fromLabel} → ${toLabel}；${sourceLabel}：${t.reason}`;
}
