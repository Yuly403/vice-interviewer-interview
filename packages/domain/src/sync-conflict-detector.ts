/**
 * SYNC-003: 同步冲突检测模块
 *
 * 在 sync（面评回写工作区）之前，检测三种冲突类型：
 *   1. stale_line      — 证据引用的逐字稿行已被删除、内容变化或版本过期
 *   2. decision_mismatch — AI 建议 vs 人工决定 vs 已有台账不一致
 *   3. missing_field    — 面评草稿关键字段缺失或工作区字段缺失
 *
 * 返回冲突数组；空数组表示无冲突，可直接同步。
 */

import type { ConflictType } from "@vice/contracts";
import { ConflictType as CT } from "@vice/contracts";

// ─── 输入/输出类型 ───

export interface DetectionEvidenceRef {
  sourceId: string;
  sourceRevision: number;
  quote: string;
}

export interface DetectionConclusion {
  dimension: string;
  text: string;
  evidenceRefs: DetectionEvidenceRef[];
}

export interface DetectionDraft {
  revision: number;
  suggestedDecision: string | null;
  humanDecision: string | null;
  overview: string | null;
  strengths: string[];
  risks: string[];
  conclusions: DetectionConclusion[];
}

export interface DetectionTranscriptLine {
  id: string;
  revision: number;
  isDeleted: boolean;
  text: string;
}

export interface DetectionExistingMeta {
  interviewId: string;
  revision: number;
  generatedAt: string;
  lineCount: number;
  evidenceCount: number;
}

export interface DetectionInput {
  draft: DetectionDraft;
  transcriptLines: DetectionTranscriptLine[];
  existingSyncMeta: DetectionExistingMeta | null;
  existingMarkdown: string | null;
  isFinalRound: boolean;
}

export interface SyncConflictDetail {
  type: ConflictType;
  fieldPath: string;
  localValue: unknown;
  remoteValue: unknown;
  message: string;
}

export interface SyncConflictDetectionResult {
  conflicts: SyncConflictDetail[];
  hasConflicts: boolean;
  conflictTypes: ConflictType[];
}

// ─── 冲突检测函数 ───

/**
 * 检测所有同步冲突。
 * 返回 SyncConflictDetectionResult；conflicts 为空数组即无冲突。
 */
export function detectSyncConflicts(input: DetectionInput): SyncConflictDetectionResult {
  const conflicts: SyncConflictDetail[] = [];

  // 1. stale_line 检测
  conflicts.push(...detectStaleLines(input.draft, input.transcriptLines));

  // 2. decision_mismatch 检测
  conflicts.push(...detectDecisionMismatch(input));

  // 3. missing_field 检测
  conflicts.push(...detectMissingFields(input));

  // 收集冲突类型
  const typeSet = new Set(conflicts.map((c) => c.type));
  const conflictTypes: ConflictType[] = [CT.StaleLine, CT.DecisionMismatch, CT.MissingField]
    .filter((t) => typeSet.has(t));

  return {
    conflicts,
    hasConflicts: conflicts.length > 0,
    conflictTypes,
  };
}

// ─── stale_line 检测（PRD SYNC-003 §1）───

function detectStaleLines(
  draft: DetectionDraft,
  transcriptLines: DetectionTranscriptLine[]
): SyncConflictDetail[] {
  const conflicts: SyncConflictDetail[] = [];
  const lineMap = new Map(transcriptLines.map((l) => [l.id, l]));

  for (const conclusion of draft.conclusions) {
    for (const ref of conclusion.evidenceRefs) {
      const line = lineMap.get(ref.sourceId);

      // 逐字稿行不存在（可能被硬删除）
      if (!line) {
        conflicts.push({
          type: CT.StaleLine,
          fieldPath: `conclusions[${conclusion.dimension}].evidence[${ref.sourceId}]`,
          localValue: { sourceRevision: ref.sourceRevision, quote: ref.quote.slice(0, 80) },
          remoteValue: null,
          message: `证据引用的逐字稿行 ${ref.sourceId} 已不存在（可能在面评生成后被删除）。请核实该证据是否仍然有效。`,
        });
        continue;
      }

      // 逐字稿行已被标记删除
      if (line.isDeleted) {
        conflicts.push({
          type: CT.StaleLine,
          fieldPath: `conclusions[${conclusion.dimension}].evidence[${ref.sourceId}]`,
          localValue: { sourceRevision: ref.sourceRevision, quote: ref.quote.slice(0, 80) },
          remoteValue: { revision: line.revision, isDeleted: true, text: line.text.slice(0, 80) },
          message: `证据引用的逐字稿行 ${ref.sourceId} 已被标记为删除。该证据不再有效，建议移除或更换引用。`,
        });
        continue;
      }

      // 逐字稿行版本号过期（行内容已更新）
      if (line.revision !== ref.sourceRevision) {
        conflicts.push({
          type: CT.StaleLine,
          fieldPath: `conclusions[${conclusion.dimension}].evidence[${ref.sourceId}]`,
          localValue: { sourceRevision: ref.sourceRevision, quote: ref.quote.slice(0, 80) },
          remoteValue: {
            revision: line.revision,
            text: line.text.slice(0, 80),
            revisionDelta: line.revision - ref.sourceRevision,
          },
          message: `证据引用的逐字稿行 ${ref.sourceId} 版本过期（证据版本 v${ref.sourceRevision} vs 当前行版本 v${line.revision}）。原文可能已修正，请核实引文是否仍然准确。`,
        });
      }
    }
  }

  return conflicts;
}

// ─── decision_mismatch 检测（PRD SYNC-003 §2）───

function detectDecisionMismatch(input: DetectionInput): SyncConflictDetail[] {
  const conflicts: SyncConflictDetail[] = [];
  const { draft, existingSyncMeta, existingMarkdown, isFinalRound } = input;

  // 2a. AI 建议 vs 人工决定不一致
  if (
    draft.suggestedDecision &&
    draft.humanDecision &&
    draft.suggestedDecision !== draft.humanDecision
  ) {
    // 这是正常的（人工可以覆写 AI），所以作为 warning 而非 blocking
    // 仅当差异显著时（pass vs reject）才标记为冲突
    const isSignificant =
      (draft.suggestedDecision === "pass" && draft.humanDecision === "reject") ||
      (draft.suggestedDecision === "reject" && draft.humanDecision === "pass");

    if (isSignificant) {
      conflicts.push({
        type: CT.DecisionMismatch,
        fieldPath: "humanDecision",
        localValue: { humanDecision: draft.humanDecision },
        remoteValue: { suggestedDecision: draft.suggestedDecision },
        message: `人工决定（${decisionLabel(draft.humanDecision)}）与 AI 建议（${decisionLabel(draft.suggestedDecision)}）方向相反。请确认审批人已审阅面评草稿并有充分理由覆写 AI 建议。`,
      });
    }
  }

  // 2b. 工作区已有档案，且决策与本次不同
  if (existingSyncMeta && existingMarkdown) {
    const hasOldPass = existingMarkdown.includes("✅ 通过") || existingMarkdown.includes("pass");
    const hasOldReject = existingMarkdown.includes("❌ 不通过") || existingMarkdown.includes("reject");
    const effectiveDecision = draft.humanDecision || draft.suggestedDecision;

    if (effectiveDecision === "pass" && hasOldReject) {
      conflicts.push({
        type: CT.DecisionMismatch,
        fieldPath: "humanDecision",
        localValue: { humanDecision: effectiveDecision },
        remoteValue: {
          existingRevision: existingSyncMeta.revision,
          existingGeneratedAt: existingSyncMeta.generatedAt,
          existingDecision: "reject",
        },
        message: `工作区已有档案（v${existingSyncMeta.revision}，${existingSyncMeta.generatedAt}）结论为"不通过"，本次同步为"通过"。请确认这是审批人修正后的最终结论。`,
      });
    } else if (effectiveDecision === "reject" && hasOldPass) {
      conflicts.push({
        type: CT.DecisionMismatch,
        fieldPath: "humanDecision",
        localValue: { humanDecision: effectiveDecision },
        remoteValue: {
          existingRevision: existingSyncMeta.revision,
          existingGeneratedAt: existingSyncMeta.generatedAt,
          existingDecision: "pass",
        },
        message: `工作区已有档案（v${existingSyncMeta.revision}，${existingSyncMeta.generatedAt}）结论为"通过"，本次同步为"不通过"。请确认这是审批人修正后的最终结论。`,
      });
    }
  }

  // 2c. 终面标记 vs 决策矛盾
  // 终面 + pass → 应后续转 offer_evaluation；终面 + reject 正常
  // 非终面 + pass → 应安排下一轮
  // 此处仅提示，不阻塞（台账映射阶段会处理）
  if (isFinalRound && (draft.humanDecision || draft.suggestedDecision) === "reject") {
    // 终面 + reject 是正常流程，不报冲突
  }

  return conflicts;
}

// ─── missing_field 检测（PRD SYNC-003 §3）───

function detectMissingFields(input: DetectionInput): SyncConflictDetail[] {
  const conflicts: SyncConflictDetail[] = [];
  const { draft } = input;

  // 3a. 人工决策缺失（关键字段）
  if (!draft.humanDecision) {
    conflicts.push({
      type: CT.MissingField,
      fieldPath: "humanDecision",
      localValue: null,
      remoteValue: null,
      message: "缺少人工最终决策（humanDecision）。审批人必须明确选择 pass / hold / reject 后方可同步。",
    });
  }

  // 3b. 综合概览缺失
  if (!draft.overview || draft.overview.trim().length === 0) {
    conflicts.push({
      type: CT.MissingField,
      fieldPath: "overview",
      localValue: null,
      remoteValue: null,
      message: "缺少综合概览（overview）。面评档案应包含面试整体评价。",
    });
  }

  // 3c. 维度结论为空
  if (!draft.conclusions || draft.conclusions.length === 0) {
    conflicts.push({
      type: CT.MissingField,
      fieldPath: "conclusions",
      localValue: { count: 0 },
      remoteValue: null,
      message: "面评草稿没有任何维度结论（conclusions 为空）。至少需要一个维度的评价才能生成有效档案。",
    });
  }

  // 3d. 单个维度结论缺少 text
  for (let i = 0; i < (draft.conclusions || []).length; i++) {
    const c = draft.conclusions[i];
    if (!c.text || c.text.trim().length === 0) {
      conflicts.push({
        type: CT.MissingField,
        fieldPath: `conclusions[${i}].text (dimension: ${c.dimension || "unknown"})`,
        localValue: { dimension: c.dimension, text: c.text },
        remoteValue: null,
        message: `维度"${c.dimension || "未知"}"的评价文本为空。每个维度都需要实质性的评价内容。`,
      });
    }
    if (!c.dimension || c.dimension.trim().length === 0) {
      conflicts.push({
        type: CT.MissingField,
        fieldPath: `conclusions[${i}].dimension`,
        localValue: { index: i },
        remoteValue: null,
        message: `第 ${i + 1} 个结论缺少维度名称（dimension）。每个结论必须关联到面试计划的某个考察维度。`,
      });
    }
  }

  return conflicts;
}

// ─── 辅助函数 ───

function decisionLabel(d: string): string {
  switch (d) {
    case "pass":
      return "通过";
    case "hold":
      return "待定";
    case "reject":
      return "不通过";
    default:
      return d;
  }
}

// ─── 工作区已有文件读取辅助（返回 DetectionExistingMeta | null）───

/**
 * 解析已有的 sync.json 字符串为 DetectionExistingMeta
 */
export function parseExistingSyncMeta(jsonStr: string): DetectionExistingMeta | null {
  try {
    const obj = JSON.parse(jsonStr);
    if (
      typeof obj.interviewId === "string" &&
      typeof obj.revision === "number" &&
      typeof obj.generatedAt === "string"
    ) {
      return {
        interviewId: obj.interviewId,
        revision: obj.revision,
        generatedAt: obj.generatedAt,
        lineCount: obj.lineCount ?? 0,
        evidenceCount: obj.evidenceCount ?? 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 判断冲突是否属于"可自动解决"类型
 * 只有 stale_line 可以通过重新生成面评自动解决
 */
export function isAutoResolvable(_conflict: SyncConflictDetail): boolean {
  // stale_line 通常需要人工核实，不可自动解决
  return false;
}

/**
 * 判断所有冲突是否都已解决（用于 sync_conflict → sync_pending 守卫）
 * 这里的"已解决"语义是：人工确认可重试同步
 */
export type ResolveAction = "retry" | "force" | "cancel";

export interface ResolveResult {
  action: ResolveAction;
  conflictsResolved: boolean;
  note: string;
}
