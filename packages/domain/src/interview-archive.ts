/**
 * SYNC-001: 面试档案 Markdown 生成器
 *
 * 将已审批的面评结果生成结构化 Markdown，写入 03-interview/<候选人>/rounds/<interviewId>/
 * 格式遵循 PRD §9.10 与 §18.3 规范
 */

// ─── 输入类型（核心字段的子集，松耦合于 Prisma） ───

export interface ArchiveParticipant {
  displayName: string;
  role: string; // "candidate" | "interviewer"
}

export interface ArchiveConclusion {
  dimension: string;
  contentType: string;
  text: string;
  aiGenerated: boolean;
  humanEdited: boolean;
  evidenceRefs: ArchiveEvidence[];
}

export interface ArchiveEvidence {
  sourceType: string;
  quote: string;
  speakerRole: string | null;
  occurredAt: string | null;
}

export interface ArchiveTopic {
  title: string;
  why: string;
  status: string;
}

export interface ArchiveInput {
  interviewId: string;
  revision: number;
  scheduledAt: string;
  roundType: string;
  positionName: string | null;
  participants: ArchiveParticipant[];
  overview: string | null;
  strengths: string[];
  risks: string[];
  openQuestions: string[];
  uncoveredTopics: string[];
  nextRoundFocus: string[];
  suggestedDecision: string | null;
  humanDecision: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  conclusions: ArchiveConclusion[];
  topics: ArchiveTopic[];
  transcriptLineCount: number;
}

export interface ArchiveOutput {
  markdown: string;
  syncMeta: {
    interviewId: string;
    revision: number;
    generatedAt: string;
    lineCount: number;
    evidenceCount: number;
  };
}

// ─── 格式化辅助函数 ───

function safeStr(v: string | null | undefined): string {
  return v || "(未填写)";
}

function listToMd(items: string[] | undefined | null, prefix: string): string {
  if (!items || items.length === 0) return `${prefix}(无)\n`;
  return items.map((s) => `${prefix}${s}`).join("\n") + "\n";
}

function decisionLabel(d: string | null): string {
  switch (d) {
    case "pass":
      return "✅ 通过";
    case "hold":
      return "⏸ 待定";
    case "reject":
      return "❌ 不通过";
    default:
      return "未定";
  }
}

function dimensionLabel(d: string): string {
  const map: Record<string, string> = {
    technical: "技术能力",
    communication: "沟通表达",
    thinking: "思维能力",
    collaboration: "协作能力",
    leadership: "领导力",
    culture: "文化匹配",
    learning: "学习能力",
    execution: "执行力",
    project: "项目经验",
  };
  return map[d] || d;
}

function contentTypeLabel(c: string): string {
  const map: Record<string, string> = {
    fact: "事实",
    inference: "推断",
    open_question: "待确认",
    human_decision: "人工判断",
  };
  return map[c] || c;
}

function roundTypeLabel(r: string): string {
  const map: Record<string, string> = {
    first_round: "初面",
    second_round: "二面",
    third_round: "三面",
    final_round: "终面",
    hr_round: "HR 面",
    phone_screen: "电话初筛",
    technical_round: "技术面",
  };
  return map[r] || r;
}

// ─── 生成 Markdown 档案 ───

export function generateInterviewArchive(input: ArchiveInput): ArchiveOutput {
  const candidate = input.participants.find((p) => p.role === "candidate");
  const interviewers = input.participants.filter((p) => p.role === "interviewer");

  const candidateName = candidate?.displayName || "未知候选人";
  const interviewerNames =
    interviewers.length > 0
      ? interviewers.map((i) => i.displayName).join("、")
      : "未知";

  const now = new Date().toISOString();
  const evidenceCount = input.conclusions.reduce(
    (sum, c) => sum + (c.evidenceRefs?.length || 0),
    0
  );

  const md = [
    // ── 头部：候选人 + 面试信息 ──
    `# ${candidateName} — ${roundTypeLabel(input.roundType)}面评档案`,
    "",
    `> **面试 ID**：\`${input.interviewId}\``,
    `> **档案版本**：v${input.revision} | 生成时间：${formatDate(now)}`,
    "",
    "---",
    "",
    "## 1. 面试概览",
    "",
    `| 字段 | 内容 |`,
    `|------|------|`,
    `| **候选人** | ${candidateName} |`,
    `| **面试官** | ${interviewerNames} |`,
    `| **岗位** | ${input.positionName || roundTypeLabel(input.roundType)} |`,
    `| **轮次** | ${roundTypeLabel(input.roundType)} |`,
    `| **面试时间** | ${formatDate(input.scheduledAt)} |`,
    `| **逐字稿行数** | ${input.transcriptLineCount} |`,
    `| **证据引用数** | ${evidenceCount} |`,
    "",
    "---",
    "",
    "## 2. 面试计划覆盖",
    "",
    ...(input.topics.length > 0
      ? [
          "| 话题 | 考察原因 | 覆盖状态 |",
          "|------|----------|----------|",
          ...input.topics.map(
            (t) =>
              `| ${t.title} | ${t.why || "—"} | ${topicStatusLabel(t.status)} |`
          ),
          "",
        ]
      : ["_(面试计划未包含话题信息)_", ""]),
    "---",
    "",
    "## 3. 综合概览",
    "",
    safeStr(input.overview),
    "",
    "---",
    "",
    "## 4. 分维度评价",
    "",
  ].join("\n");

  // ── 分维度评价 ──
  const dimensionSections: string[] = [];

  // 按维度分组
  const byDim = new Map<string, ArchiveConclusion[]>();
  for (const c of input.conclusions) {
    if (!byDim.has(c.dimension)) byDim.set(c.dimension, []);
    byDim.get(c.dimension)!.push(c);
  }

  for (const [dim, items] of byDim) {
    const lines: string[] = [
      `### ${dimensionLabel(dim)}`,
      "",
    ];

    for (const item of items) {
      lines.push(
        `**${contentTypeLabel(item.contentType)}**${item.aiGenerated ? " (AI)" : ""}${item.humanEdited ? " (人工修订)" : ""}`,
        "",
        item.text,
        ""
      );

      if (item.evidenceRefs && item.evidenceRefs.length > 0) {
        lines.push("**证据引用：**");
        lines.push("");
        for (const ref of item.evidenceRefs) {
          const speaker = ref.speakerRole
            ? ` [${ref.speakerRole === "candidate" ? "候选人" : ref.speakerRole === "interviewer" ? "面试官" : ref.speakerRole}]`
            : "";
          lines.push(
            `- ${ref.sourceType}${speaker}：${formatDate(ref.occurredAt)}`,
            `  > "${ref.quote}"`,
            ""
          );
        }
      }

      lines.push("---");
      lines.push("");
    }

    dimensionSections.push(lines.join("\n"));
  }

  const mdMiddle = dimensionSections.join("\n");

  // ── 评估结论区 ──
  const mdTail = [
    "## 5. 亮点",
    "",
    listToMd(input.strengths, "- "),
    "",
    "## 6. 风险与待确认",
    "",
    listToMd(input.risks, "- "),
    "",
    ...(input.openQuestions.length > 0
      ? [
          "### 待确认问题",
          "",
          listToMd(input.openQuestions, "- "),
          "",
        ]
      : []),
    ...(input.uncoveredTopics.length > 0
      ? [
          "### 未覆盖话题",
          "",
          listToMd(input.uncoveredTopics, "- "),
          "",
        ]
      : []),
    "## 7. 结论",
    "",
    "| 类型 | 结论 |",
    "|------|------|",
    `| AI 建议 | ${decisionLabel(input.suggestedDecision)} |`,
    `| 人工决定 | ${decisionLabel(input.humanDecision)}`,
    "",
    ...(input.nextRoundFocus.length > 0
      ? [
          "### 下轮关注",
          "",
          listToMd(input.nextRoundFocus, "- "),
          "",
        ]
      : []),
    "---",
    "",
    "## 8. 审批信息",
    "",
    `| 字段 | 内容 |`,
    `|------|------|`,
    `| **审批人** | ${safeStr(input.approvedBy)} |`,
    `| **审批时间** | ${input.approvedAt ? formatDate(input.approvedAt) : "(未审批)"} |`,
    `| **档案版本** | v${input.revision} |`,
    "",
    "---",
    "",
    `*本文档由第二面试官自动生成，审批人确认后写入工作区。原始逐字稿不进入此档案。*`,
    "",
  ].join("\n");

  const fullMarkdown = md + mdMiddle + mdTail;

  const syncMeta = {
    interviewId: input.interviewId,
    revision: input.revision,
    generatedAt: now,
    lineCount: input.transcriptLineCount,
    evidenceCount,
  };

  return { markdown: fullMarkdown, syncMeta };
}

// ─── 安全命名：候选姓名 → 文件系统安全名称 ───

export function toSafeName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

// ─── 格式化日期/时间 ───

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "(未知时间)";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${h}:${min}`;
  } catch {
    return iso;
  }
}

function topicStatusLabel(s: string): string {
  const map: Record<string, string> = {
    unasked: "未提问",
    started: "已开始",
    evidence_partial: "部分覆盖",
    needs_followup: "需跟进",
    covered: "已覆盖",
    skipped_by_human: "跳过低优先级",
    not_applicable: "不适用",
  };
  return map[s] || s;
}
