/**
 * SYNC-004: 后续动作建议引擎
 *
 * 面评同步完成后，根据面试结论、轮次、台账状态和未覆盖知识点，
 * 生成结构化后续动作建议列表，供前端渲染为 checklist / 看板卡片。
 *
 * 规则来源：PRD §10.4 SYNC-004 + §9.10 面试归档
 */

import {
  HumanDecision as HD,
} from "@vice/contracts";
import type { LedgerStatus } from "@vice/contracts";

// ─── 动作类型枚举 ───

export const SyncActionType = {
  /** 安排下一轮面试（pass + 非终面） */
  ScheduleNextRound: "schedule_next_round",
  /** 启动 Offer 评估流程（pass + 终面） */
  OfferEvaluation: "offer_evaluation",
  /** 发送婉拒话术（reject） */
  SendRejection: "send_rejection",
  /** 补充证据 / 跟进待确认问题（openQuestions / uncoveredTopics） */
  FillEvidenceGap: "fill_evidence_gap",
  /** 更新台账状态（always） */
  UpdateLedger: "update_ledger",
  /** 通知面试官 / HR（sync 完成通知） */
  NotifyTeam: "notify_team",
  /** 归档面评到候选人档案（always / 已完成时可标记） */
  ArchiveReview: "archive_review",
  /** 待定决策需补充更多轮次信息（hold） */
  GatherMoreInfo: "gather_more_info",
  /** 人工确认台账变更（autoEffective === false） */
  ConfirmLedgerChange: "confirm_ledger_change",
} as const;

export type SyncActionType = (typeof SyncActionType)[keyof typeof SyncActionType];

// ─── 动作优先级 ───

export const ActionPriority = {
  High: "high",
  Medium: "medium",
  Low: "low",
} as const;

export type ActionPriority = (typeof ActionPriority)[keyof typeof ActionPriority];

// ─── 执行角色 ───

export const TargetRole = {
  Recruiter: "recruiter",
  HiringManager: "hiring_manager",
  Interviewer: "interviewer",
  System: "system",
} as const;

export type TargetRole = (typeof TargetRole)[keyof typeof TargetRole];

// ─── 单条动作建议 ───

export interface SyncAction {
  /** 动作类型 */
  type: SyncActionType;
  /** 优先级 */
  priority: ActionPriority;
  /** 简短标题（≤20 字） */
  title: string;
  /** 详细描述（1-3 句话） */
  description: string;
  /** 执行角色 */
  targetRole: TargetRole;
  /** 前置条件（空数组表示无前置） */
  dependsOn: SyncActionType[];
  /** 是否可由系统自动触发 */
  autoTriggerable: boolean;
}

// ─── 输入参数 ───

export interface AdvisorInput {
  /** 人工决定 */
  humanDecision: string | null;
  /** AI 建议 */
  suggestedDecision: string | null;
  /** 是否终面 */
  isFinalRound: boolean;
  /** 台账映射结果状态 */
  ledgerStatus: LedgerStatus;
  /** 台账是否自动生效 */
  ledgerAutoEffective: boolean;
  /** 待确认问题数量 */
  openQuestionCount: number;
  /** 未覆盖话题数量 */
  uncoveredTopicCount: number;
  /** 下轮关注点数量 */
  nextRoundFocusCount: number;
  /** 证据引用数 */
  evidenceCount: number;
  /** 亮点数 */
  strengthCount: number;
  /** 风险数 */
  riskCount: number;
  /** 是否包含冲突（刚从 sync_conflict 恢复则为 true） */
  hadConflicts: boolean;
}

// ─── 输出 ───

export interface AdvisorOutput {
  /** 建议动作列表（按优先级排序） */
  actions: SyncAction[];
  /** 总动作数 */
  total: number;
  /** 各优先级计数 */
  breakdown: {
    high: number;
    medium: number;
    low: number;
  };
  /** 核心决策动作（sort order 第一） */
  primaryAction: SyncAction | null;
  /** 人类可读的总结文本 */
  summary: string;
}

// ─── 预定义动作模板 ───

const ACTION_TEMPLATES: Record<string, Omit<SyncAction, "priority" | "autoTriggerable">> = {
  schedule_next_round: {
    type: SyncActionType.ScheduleNextRound,
    title: "安排下一轮面试",
    description: "",
    targetRole: TargetRole.Recruiter,
    dependsOn: [],
  },
  offer_evaluation: {
    type: SyncActionType.OfferEvaluation,
    title: "启动 Offer 评估流程",
    description: "",
    targetRole: TargetRole.HiringManager,
    dependsOn: [SyncActionType.ConfirmLedgerChange],
  },
  send_rejection: {
    type: SyncActionType.SendRejection,
    title: "发送婉拒通知",
    description: "",
    targetRole: TargetRole.Recruiter,
    dependsOn: [SyncActionType.ConfirmLedgerChange],
  },
  fill_evidence_gap: {
    type: SyncActionType.FillEvidenceGap,
    title: "补充证据 / 跟进待确认项",
    description: "",
    targetRole: TargetRole.Interviewer,
    dependsOn: [],
  },
  update_ledger: {
    type: SyncActionType.UpdateLedger,
    title: "更新招聘台账",
    description: "",
    targetRole: TargetRole.Recruiter,
    dependsOn: [],
  },
  notify_team: {
    type: SyncActionType.NotifyTeam,
    title: "通知面试官 / HR 面评已归档",
    description: "",
    targetRole: TargetRole.System,
    dependsOn: [],
  },
  archive_review: {
    type: SyncActionType.ArchiveReview,
    title: "面评已归档至候选人档案",
    description: "",
    targetRole: TargetRole.System,
    dependsOn: [],
  },
  gather_more_info: {
    type: SyncActionType.GatherMoreInfo,
    title: "收集补充信息以做出决定",
    description: "",
    targetRole: TargetRole.HiringManager,
    dependsOn: [],
  },
  confirm_ledger_change: {
    type: SyncActionType.ConfirmLedgerChange,
    title: "确认台账状态变更",
    description: "",
    targetRole: TargetRole.HiringManager,
    dependsOn: [],
  },
};

// ─── 核心建议引擎 ───

export function generateSyncActions(input: AdvisorInput): AdvisorOutput {
  const actions: SyncAction[] = [];

  const { humanDecision, isFinalRound, ledgerAutoEffective } = input;

  // ═══════════════════════════════════════════════
  // Rule 1: 决策导向动作（总是有且仅有一个主导动作）
  // ═══════════════════════════════════════════════

  if (humanDecision === HD.Pass) {
    if (isFinalRound) {
      // Pass + 终面 → Offer 评估
      actions.push({
        ...ACTION_TEMPLATES.offer_evaluation,
        priority: ActionPriority.High,
        autoTriggerable: false,
        description: `终面通过，建议进入 Offer 评估阶段。${ledgerAutoEffective ? "台账已自动标记。" : "需人工确认台账变更。"}`,
        dependsOn: ledgerAutoEffective ? [] : [SyncActionType.ConfirmLedgerChange],
      });
    } else {
      // Pass + 非终面 → 安排下一轮
      actions.push({
        ...ACTION_TEMPLATES.schedule_next_round,
        priority: ActionPriority.High,
        autoTriggerable: true,
        description:
          `面试通过${input.nextRoundFocusCount > 0 ? `，下轮建议关注 ${input.nextRoundFocusCount} 个重点方向` : "，自动标记进入下一轮"}。` +
          `${input.nextRoundFocusCount > 0 ? " 请参考面评中的「下轮关注」制定下一轮面试计划。" : ""}`,
        dependsOn: [],
      });
    }
  } else if (humanDecision === HD.Reject) {
    // Reject → 发送婉拒
    actions.push({
      ...ACTION_TEMPLATES.send_rejection,
      priority: ActionPriority.High,
      autoTriggerable: false,
      description: `面试不通过，建议发送婉拒通知。${ledgerAutoEffective ? "台账已自动标记为「已拒」。" : "需人工确认后方可发送。"}`,
      dependsOn: ledgerAutoEffective ? [] : [SyncActionType.ConfirmLedgerChange],
    });
  } else if (humanDecision === HD.Hold) {
    // Hold → 收集更多信息
    actions.push({
      ...ACTION_TEMPLATES.gather_more_info,
      priority: ActionPriority.High,
      autoTriggerable: false,
      description: `面试结果为「待定」，需补充信息后重新评估。${input.openQuestionCount > 0 ? `当前有 ${input.openQuestionCount} 个待确认问题需要跟进。` : ""}`,
      dependsOn: [],
    });
  } else {
    // 无人工决定（防御）
    actions.push({
      ...ACTION_TEMPLATES.gather_more_info,
      priority: ActionPriority.High,
      autoTriggerable: false,
      description: "面评已归档但缺少人工结论，请尽快补充决策。",
      dependsOn: [],
    });
  }

  // ═══════════════════════════════════════════════
  // Rule 2: 台账相关动作
  // ═══════════════════════════════════════════════

  if (!ledgerAutoEffective) {
    // 台账需人工确认
    actions.push({
      ...ACTION_TEMPLATES.confirm_ledger_change,
      priority: ActionPriority.High,
      autoTriggerable: false,
      description: `台账状态变更需要人工确认。当前决策需要你手动在台账中标记。`,
      dependsOn: [],
    });
  } else {
    // 台账已自动更新，标记为已完成
    actions.push({
      ...ACTION_TEMPLATES.update_ledger,
      priority: ActionPriority.Low,
      autoTriggerable: true,
      description: "台账状态已自动同步更新。",
      dependsOn: [],
    });
  }

  // ═══════════════════════════════════════════════
  // Rule 3: 证据缺口 → 补充证据
  // ═══════════════════════════════════════════════

  const hasGaps =
    input.openQuestionCount > 0 ||
    input.uncoveredTopicCount > 0 ||
    input.evidenceCount < 3;

  if (hasGaps) {
    const parts: string[] = [];
    if (input.openQuestionCount > 0) {
      parts.push(`${input.openQuestionCount} 个待确认问题`);
    }
    if (input.uncoveredTopicCount > 0) {
      parts.push(`${input.uncoveredTopicCount} 个未覆盖话题`);
    }
    if (input.evidenceCount < 3 && humanDecision !== HD.Reject) {
      parts.push(`证据引用较少（${input.evidenceCount} 条）`);
    }

    actions.push({
      ...ACTION_TEMPLATES.fill_evidence_gap,
      priority: humanDecision === HD.Hold ? ActionPriority.High : ActionPriority.Medium,
      autoTriggerable: false,
      description: `面评中存在 ${parts.join("、")}。${humanDecision === HD.Hold ? "在做出最终决定前建议先补充。" : "建议在下一轮面试中重点覆盖。"}`,
      dependsOn: [],
    });
  }

  // ═══════════════════════════════════════════════
  // Rule 4: 通知团队（sync 成功后的信息同步）
  // ═══════════════════════════════════════════════

  actions.push({
    ...ACTION_TEMPLATES.notify_team,
    priority: ActionPriority.Medium,
    autoTriggerable: true,
    description: `面评已同步到 ${isFinalRound ? "终面" : "本轮"}档案。${humanDecision === HD.Reject ? "建议通知面试官结果。" : "建议通知相关面试官下一轮关注点。"}`,
    dependsOn: [],
  });

  // ═══════════════════════════════════════════════
  // Rule 5: 归档确认（系统级 / 信息展示）
  // ═══════════════════════════════════════════════

  actions.push({
    ...ACTION_TEMPLATES.archive_review,
    priority: ActionPriority.Low,
    autoTriggerable: true,
    description: `面评已归档至候选人工作区（v${isFinalRound ? "终面" : "本轮"}），包含 ${input.evidenceCount} 条证据引用。`,
    dependsOn: [],
  });

  // ═══════════════════════════════════════════════
  // Rule 6: 冲突恢复提示
  // ═══════════════════════════════════════════════

  if (input.hadConflicts) {
    actions.push({
      type: SyncActionType.ArchiveReview,
      priority: ActionPriority.Medium,
      title: "冲突已解决，重新同步成功",
      description: "之前检测到的同步冲突已通过人工处理解决，本次同步为 force-retry 版本。",
      targetRole: TargetRole.System,
      dependsOn: [],
      autoTriggerable: true,
    });
  }

  // ═══════════════════════════════════════════════
  // 排序与汇总
  // ═══════════════════════════════════════════════

  const priorityOrder: Record<ActionPriority, number> = {
    [ActionPriority.High]: 0,
    [ActionPriority.Medium]: 1,
    [ActionPriority.Low]: 2,
  };

  actions.sort((a, b) => {
    const pa = priorityOrder[a.priority];
    const pb = priorityOrder[b.priority];
    if (pa !== pb) return pa - pb;
    // 同一优先级：决策动作排第一
    const decisionTypes = new Set<string>([
      SyncActionType.ScheduleNextRound,
      SyncActionType.OfferEvaluation,
      SyncActionType.SendRejection,
      SyncActionType.GatherMoreInfo,
    ]);
    const aIsDecision = decisionTypes.has(a.type);
    const bIsDecision = decisionTypes.has(b.type);
    if (aIsDecision && !bIsDecision) return -1;
    if (!aIsDecision && bIsDecision) return 1;
    return 0;
  });

  const breakdown = {
    high: actions.filter((a) => a.priority === ActionPriority.High).length,
    medium: actions.filter((a) => a.priority === ActionPriority.Medium).length,
    low: actions.filter((a) => a.priority === ActionPriority.Low).length,
  };

  // ── 生成人类可读摘要 ──

  const decisionPart =
    humanDecision === HD.Pass
      ? isFinalRound
        ? "建议启动 Offer 评估"
        : "建议安排下一轮面试"
      : humanDecision === HD.Reject
        ? "建议发送婉拒通知"
        : humanDecision === HD.Hold
          ? "当前为待定状态，需补充信息"
          : "缺少人工结论，请尽快决策";

  const gapPart =
    input.openQuestionCount > 0 || input.uncoveredTopicCount > 0
      ? `，有 ${input.openQuestionCount + input.uncoveredTopicCount} 个信息缺口`
      : "";

  const summary = `${decisionPart}${gapPart}。共 ${actions.length} 项后续动作（${breakdown.high} 高优先级 / ${breakdown.medium} 中 / ${breakdown.low} 低）。`;

  return {
    actions,
    total: actions.length,
    breakdown,
    primaryAction: actions[0] || null,
    summary,
  };
}
